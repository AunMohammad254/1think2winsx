// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));

const { lockinDrain } = await import('@/lib/lockin-drain');

const fetchMock = vi.fn();
const tally = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  adminDb = createSupabaseMock();
  adminDb.setTable('LockinDrain', { data: { processed: 120 } });
  fetchMock.mockReset().mockResolvedValue(tally({ quizId: 'q1', received: 150 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('LOCKIN_EDGE', 'true');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://1think2win.com/');
  vi.stubEnv('CRON_SECRET', 'cron-secret');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('lockinDrain', () => {
  it('is null, reading nothing, while the edge queue is not in use', async () => {
    vi.stubEnv('LOCKIN_EDGE', 'false');
    expect(await lockinDrain('q1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminDb.calls).toHaveLength(0);
  });

  it("compares the edge's tally with what the database processed", async () => {
    expect(await lockinDrain('quiz 1')).toEqual({ received: 150, processed: 120 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://1think2win.com/api/edge/lockin-status?quiz=quiz%201');
    expect(init.headers).toEqual({ Authorization: 'Bearer cron-secret' });
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(eqValue(adminDb.callsTo('LockinDrain')[0], 'quizId')).toBe('quiz 1');
  });

  it('counts nothing processed before the first batch reaches the database', async () => {
    adminDb.setTable('LockinDrain', { data: null });
    expect(await lockinDrain('q1')).toEqual({ received: 150, processed: 0 });
  });

  it('throws when the switch is on but the site address or the secret is missing', async () => {
    vi.stubEnv('CRON_SECRET', '');
    await expect(lockinDrain('q1')).rejects.toThrow('NEXT_PUBLIC_SITE_URL or CRON_SECRET is missing');
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    await expect(lockinDrain('q1')).rejects.toThrow('NEXT_PUBLIC_SITE_URL or CRON_SECRET is missing');
  });

  it('throws when the tally cannot be read, so a result is never saved on a guess', async () => {
    fetchMock.mockResolvedValueOnce(tally({ error: 'no' }, 401));
    await expect(lockinDrain('q1')).rejects.toThrow('lockin-status answered 401');
    for (const body of [{ received: -1 }, { received: 1.5 }, {}, 'not json']) {
      fetchMock.mockResolvedValueOnce(typeof body === 'string' ? new Response(body) : tally(body));
      await expect(lockinDrain('q1')).rejects.toThrow('lockin-status sent no count');
    }
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await expect(lockinDrain('q1')).rejects.toThrow('timeout');
  });

  it('throws when the database count cannot be read', async () => {
    adminDb.setTable('LockinDrain', { error: { message: 'relation does not exist' } });
    await expect(lockinDrain('q1')).rejects.toEqual({ message: 'relation does not exist' });
  });
});
