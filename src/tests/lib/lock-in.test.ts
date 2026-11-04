import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ refreshSession: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { refreshSession: h.refreshSession } }) }));

import { LOCK_IN_DIRECT_HEADER, LOCK_IN_RECEIVED, sendLockIn } from '@/lib/lock-in';

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const expired = () => json({ error: 'Your session has expired', code: 'session_expired' }, 401);
const received = () => json({ results: { status: 'received' } }, 202);

beforeEach(() => {
  h.refreshSession.mockReset().mockResolvedValue({ data: { session: {} }, error: null });
});

describe('sendLockIn', () => {
  it("names the edge Worker's answer and the header that sends a match over past its queue", () => {
    expect(LOCK_IN_RECEIVED).toBe(202);
    expect(LOCK_IN_DIRECT_HEADER).toBe('X-Lockin-Direct');
  });

  it('sends once and hands back any answer that is not a lapsed session, untouched', async () => {
    for (const res of [received(), json({ success: true }, 200), json({ error: 'Unauthorized' }, 401), new Response('<html>', { status: 401 })]) {
      const send = vi.fn(async () => res);
      expect(await sendLockIn(send)).toBe(res);
      expect(send).toHaveBeenCalledTimes(1);
    }
    expect(h.refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes a lapsed session with the browser client, then sends once more', async () => {
    const send = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(received());
    const res = await sendLockIn(send);
    expect(res.status).toBe(202);
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);

    // Lapsed again: only one more try, whose answer stands
    const again = vi.fn().mockImplementation(async () => expired());
    const second = await sendLockIn(again);
    expect(second.status).toBe(401);
    expect(await second.json()).toMatchObject({ code: 'session_expired' });
    expect(again).toHaveBeenCalledTimes(2);
  });

  it("doesn't send again when the session can't be refreshed (signed out elsewhere): the 401 stands, its body unread", async () => {
    h.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('Invalid Refresh Token') });
    const send = vi.fn(async () => expired());
    const res = await sendLockIn(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ error: 'Your session has expired', code: 'session_expired' });
  });
});
