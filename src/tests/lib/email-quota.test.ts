// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

const q = await import('@/lib/email-quota');

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('reserveEmails', () => {
  it('counts the emails through reserve_email_quota', async () => {
    rpc.mockResolvedValue({ data: { ok: true, id: 12, used: 1, cap: 279, remaining: 278 }, error: null });
    expect(await q.reserveEmails('registration')).toEqual({ ok: true, id: 12 });
    expect(rpc).toHaveBeenCalledWith('reserve_email_quota', { p_kind: 'registration', p_emails: 1 });

    await q.reserveEmails('newsletter', 450);
    expect(rpc).toHaveBeenLastCalledWith('reserve_email_quota', { p_kind: 'newsletter', p_emails: 450 });
  });

  it('passes on a refusal with what is left and when to retry', async () => {
    rpc.mockResolvedValue({ data: { ok: false, used: 279, cap: 279, remaining: 0, retryAt: '2026-10-22T15:15:00+00:00' }, error: null });
    expect(await q.reserveEmails('registration')).toEqual({ ok: false, used: 279, cap: 279, remaining: 0, retryAt: '2026-10-22T15:15:00+00:00' });
    rpc.mockResolvedValue({ data: { ok: false, used: 0, cap: 279, remaining: 279 }, error: null });
    expect(await q.reserveEmails('newsletter', 300)).toMatchObject({ ok: false, retryAt: null });
  });

  it('lets the email go uncounted when the count cannot be checked', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    expect(await q.reserveEmails('password')).toEqual({ ok: true, id: null });
    rpc.mockRejectedValue(new Error('network'));
    expect(await q.reserveEmails('password')).toEqual({ ok: true, id: null });
    // an answer without an id is counted but can't be given back
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await q.reserveEmails('support')).toEqual({ ok: true, id: null });
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe('releaseEmails', () => {
  it('gives the reservation back, or keeps part of it', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await q.releaseEmails(12);
    await q.releaseEmails(12, 30);
    expect(rpc.mock.calls).toEqual([
      ['release_email_quota', { p_id: 12, p_keep: 0 }],
      ['release_email_quota', { p_id: 12, p_keep: 30 }],
    ]);
  });

  it('does nothing for an uncounted email, and only logs a failure', async () => {
    await q.releaseEmails(null);
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await expect(q.releaseEmails(1)).resolves.toBeUndefined();
    rpc.mockRejectedValueOnce(new Error('network'));
    await expect(q.releaseEmails(1)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe('getEmailQuotaStatus', () => {
  it('reads email_quota_status, and throws when it cannot', async () => {
    const status = { used: 3, limit: 299, reserve: 20, cap: 279, remaining: 296, capRemaining: 276, nextFreeAt: null };
    rpc.mockResolvedValueOnce({ data: status, error: null });
    expect(await q.getEmailQuotaStatus()).toEqual(status);
    expect(rpc).toHaveBeenCalledWith('email_quota_status');

    const error = { message: 'no such function' };
    rpc.mockResolvedValueOnce({ data: null, error });
    await expect(q.getEmailQuotaStatus()).rejects.toBe(error);
  });
});

describe('messages, in Pakistan time', () => {
  const now = new Date('2026-10-22T10:00:00Z'); // 3:00 PM PKT

  it('says today or tomorrow by the Pakistan date, rounding up to the minute', () => {
    expect(q.retryText('2026-10-22T15:14:01Z', now)).toBe('today after 8:15 PM PKT');
    expect(q.retryText('2026-10-22T15:15:00Z', now)).toBe('today after 8:15 PM PKT');
    // 7:30 PM UTC is already the next day in Pakistan
    expect(q.retryText('2026-10-22T19:30:00Z', now)).toBe('tomorrow after 12:30 AM PKT');
    expect(q.retryText('2026-10-25T04:00:00Z', now)).toBe('after Sun, Oct 25, 9:00 AM PKT');
  });

  it('follows the configured business time zone', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_TIME_ZONE', 'Asia/Dubai');
    expect(q.retryText('2026-10-22T15:15:00Z', now)).toBe('today after 7:15 PM GST');
  });

  it('words a registration differently from the other emails', () => {
    expect(q.limitMessage('registration', '2026-10-23T03:00:00Z', now)).toBe(
      "Today's registration limit has been reached. Please try again tomorrow after 8:00 AM PKT.",
    );
    expect(q.limitMessage('password', '2026-10-22T11:00:00Z', now)).toBe(
      "Today's email limit has been reached, so we can't send this email right now. Please try again today after 4:00 PM PKT.",
    );
    expect(q.limitMessage('registration', null, now)).toBe("Today's registration limit has been reached. Please try again tomorrow.");
  });

  it('uses the current time by default', () => {
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      expect(q.retryText('2026-10-22T11:00:00Z')).toBe('today after 4:00 PM PKT');
      expect(q.limitMessage('support', null)).toMatch(/try again tomorrow\.$/);
    } finally {
      vi.useRealTimers();
    }
  });
});
