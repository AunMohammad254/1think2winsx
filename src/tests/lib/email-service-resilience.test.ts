// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ default: { log: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/newsletter-unsubscribe', () => ({
  buildUnsubscribePageUrl: (e: string) => `https://x.test/unsub?e=${e}`,
  buildOneClickUnsubscribeUrl: (e: string) => `https://x.test/oneclick?e=${e}`,
}));

import { sendNewsletterEmail } from '@/lib/email-service';

const ok = () => new Response(JSON.stringify({ messageId: 'm' }), { status: 201 });

beforeEach(() => {
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
    expect(res).toMatchObject({ sentCount: 0, error: '1 of 1 failed. First error: socket hang up' });
  });
});
