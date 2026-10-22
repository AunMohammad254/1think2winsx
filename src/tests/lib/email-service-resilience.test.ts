// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ default: { log: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
// Brevo is the selected service unless a test sets the AppSettings row; the email log accepts every insert
const dbState = vi.hoisted(() => ({ provider: null as string | null }));
vi.mock('@/lib/supabase/db', async () => {
  const { createSupabaseMock } = await import('@/tests/helpers/supabase-mock');
  const db = createSupabaseMock({ tables: { AppSettings: () => ({ data: dbState.provider ? { value: dbState.provider } : null }) } });
  return { getAdminDb: () => db.client };
});
vi.mock('@/lib/newsletter-unsubscribe', () => ({
  buildUnsubscribePageUrl: (e: string) => `https://x.test/unsub?e=${e}`,
  buildOneClickUnsubscribeUrl: (e: string) => `https://x.test/oneclick?e=${e}`,
}));

import { sendNewsletterEmail } from '@/lib/email-service';
import { invalidateProviderCache } from '@/lib/mail/mailer';

const ok = () => new Response(JSON.stringify({ messageId: 'm' }), { status: 201 });

beforeEach(() => {
  dbState.provider = null;
  invalidateProviderCache();
  process.env.BREVO_API_KEY = 'test-key';
  // zero jitter: retries wait 0 ms so the tests are instant
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.BREVO_API_KEY;
});

const send = (recipients: string[]) =>
  sendNewsletterEmail({ senderEmail: 'news@x.test', subject: 'Hi', content: 'Hello', recipients });

describe('sendNewsletterEmail resilience', () => {
  it('retries a Brevo 429 (rate limit) and still delivers every email', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockImplementation(async () => ok());
    vi.stubGlobal('fetch', f);
    const res = await send(['a@x.test', 'b@x.test']);
    expect(res).toMatchObject({ success: true, sentCount: 2, failedCount: 0 });
    expect(f).toHaveBeenCalledTimes(3); // 429 + retry for the first recipient, 1 for the second
  });

  it('does not retry a 400 (bad address): that would only repeat the failure', async () => {
    const f = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', f);
    const res = await send(['bad']);
    expect(f).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ success: false, sentCount: 0, failedCount: 1 });
  });

  it('does not retry a 500: the email may already have been accepted', async () => {
    const f = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', f);
    await send(['a@x.test']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('gives every request a timeout signal so a hung connection cannot stall the blast', async () => {
    const f = vi.fn().mockImplementation(async () => ok());
    vi.stubGlobal('fetch', f);
    await send(['a@x.test']);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a timed-out request is counted as failed and NOT repeated (no double emails)', async () => {
    const f = vi.fn((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        if (init?.signal?.aborted) rej(init.signal.reason);
        else init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
      }));
    vi.stubGlobal('fetch', f);
    // shrink the 15 s ceiling for the test by aborting the platform timer
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    const res = await send(['a@x.test']);
    expect(f).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ success: false, sentCount: 0, failedCount: 1 });
  });

  it('one failing recipient does not stop the others', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('bad', { status: 400 }))
      .mockImplementation(async () => ok());
    vi.stubGlobal('fetch', f);
    const res = await send(['bad', 'a@x.test', 'b@x.test']);
    expect(res).toMatchObject({ success: true, sentCount: 2, failedCount: 1 });
  });

  it('refuses to run without an API key', async () => {
    delete process.env.BREVO_API_KEY;
    const res = await send(['a@x.test']);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/BREVO_API_KEY/);
    // A caller that passes no recipient list still gets a count back
    expect(await sendNewsletterEmail({ senderEmail: 'n@x.test', subject: 's', content: 'c', recipients: undefined as unknown as string[] })).toMatchObject({ failedCount: 0 });
  });

  it('reports a failure that is not an Error object', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('socket hang up'));
    const res = await send(['a@x.test']);
    expect(res).toMatchObject({ sentCount: 0, error: '1 of 1 failed. First error: Brevo could not be reached: socket hang up' });
  });

  it('sends through Amazon SES in groups of 12, one group a second, once an admin selected it', async () => {
    dbState.provider = 'ses';
    vi.stubEnv('AWS_SES_ACCESS_KEY_ID', 'AKID');
    vi.stubEnv('AWS_SES_SECRET_ACCESS_KEY', 'secret');
    const startedAt: number[] = [];
    const f = vi.fn(async (request: Request) => {
      startedAt.push(Date.now());
      return new Response(JSON.stringify({ MessageId: `ses-${request.url.length}` }), { status: 200 });
    });
    vi.stubGlobal('fetch', f);
    try {
      const recipients = Array.from({ length: 13 }, (_, i) => `fan${i}@x.test`);
      const calledAt = Date.now();
      expect(await send(recipients)).toEqual({ success: true, sentCount: 13, failedCount: 0, error: undefined });
      expect(f.mock.calls.every(([r]) => r.url === 'https://email.ap-southeast-2.amazonaws.com/v2/email/outbound-emails')).toBe(true);
      // The first 12 start before the 13th, and the 13th waits a full second from when the group
      // began (measured from the call, so a slow machine can't make it look shorter): SES never
      // sees more than 12 starts in a second. Node timers can fire up to a millisecond early.
      expect(Math.max(...startedAt.slice(0, 12))).toBeLessThan(startedAt[12]);
      expect(startedAt[12] - calledAt).toBeGreaterThanOrEqual(995);

      // a list that fits in one group doesn't wait at all
      const before = Date.now();
      await send(['a@x.test', 'b@x.test']);
      expect(Date.now() - before).toBeLessThan(900);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
