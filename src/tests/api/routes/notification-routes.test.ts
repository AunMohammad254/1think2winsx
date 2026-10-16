// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const auth = vi.fn();
const validateAdminSession = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const notificationDb = {
  getUnreadCount: vi.fn(), getUserNotifications: vi.fn(), markAllAsRead: vi.fn(), markAsRead: vi.fn(),
  deleteAllNotifications: vi.fn(), deleteNotification: vi.fn(), savePushSubscription: vi.fn(), deletePushSubscription: vi.fn(),
  scheduleNotification: vi.fn(), create: vi.fn(), createBroadcast: vi.fn(),
};
const findByEmail = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client, notificationDb, userDb: { findByEmail: (...a: unknown[]) => findByEmail(...a) } }));
vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: (...a: unknown[]) => validateAdminSession(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { general: 'general', admin: 'admin' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));

const user = await import('@/app/api/notifications/route');
const sub = await import('@/app/api/notifications/subscribe/route');
const admin = await import('@/app/api/admin/notifications/route');

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [auth, validateAdminSession, requireCSRFToken, applyRateLimit, findByEmail, ...Object.values(notificationDb)]) fn.mockReset();
  auth.mockResolvedValue({ user: { id: 'user-1' } });
  validateAdminSession.mockResolvedValue({ valid: true, email: 'boss@example.test' });
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const signedOut = async (call: () => Promise<Response>) => {
  auth.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(401);
  auth.mockResolvedValueOnce({ user: null });
  expect((await call()).status).toBe(401);
};

describe('/api/notifications', () => {
  it('GET lists notifications with the unread count, or only the count for the badge', async () => {
    notificationDb.getUserNotifications.mockResolvedValue([{ id: 'a', read: false }, { id: 'b', read: true }]);
    expect(await (await user.GET(makeRequest('/api/notifications'))).json()).toEqual({ success: true, notifications: [{ id: 'a', read: false }, { id: 'b', read: true }], unreadCount: 1 });
    notificationDb.getUnreadCount.mockResolvedValue(7);
    expect(await (await user.GET(makeRequest('/api/notifications?countOnly=1'))).json()).toEqual({ success: true, unreadCount: 7 });
    expect(notificationDb.getUserNotifications).toHaveBeenCalledTimes(1);
  });

  it('GET requires a session and reports errors', async () => {
    await signedOut(() => user.GET(makeRequest('/api/notifications')));
    notificationDb.getUserNotifications.mockRejectedValue(new Error('db'));
    expect((await user.GET(makeRequest('/api/notifications'))).status).toBe(500);
  });

  it.each([
    ['PUT', 'markAllAsRead', 'markAsRead', 'All notifications marked as read', 'Notification marked as read'],
    ['DELETE', 'deleteAllNotifications', 'deleteNotification', 'All notifications cleared', 'Notification deleted'],
  ] as const)('%s acts on one notification or all of them', async (method, allFn, oneFn, allMsg, oneMsg) => {
    const call = (body: unknown) => (method === 'PUT' ? user.PUT : user.DELETE)(makeRequest('/api/notifications', { method, body }));
    expect((await (await call({ all: true })).json()).message).toBe(allMsg);
    expect(notificationDb[allFn]).toHaveBeenCalledWith('user-1');
    expect((await (await call({ notificationId: 'n1' })).json()).message).toBe(oneMsg);
    expect(notificationDb[oneFn]).toHaveBeenCalledWith('n1', 'user-1');
    expect((await call({})).status).toBe(400);

    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await call({ all: true })).status).toBe(403);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await call({ all: true })).status).toBe(429);
    await signedOut(() => call({ all: true }));
    notificationDb[allFn].mockRejectedValueOnce(new Error('db'));
    expect((await call({ all: true })).status).toBe(500);
  });
});

describe('/api/notifications/subscribe', () => {
  const post = (body: unknown) => sub.POST(makeRequest('/api/notifications/subscribe', { body }));
  const del = (body: unknown) => sub.DELETE(makeRequest('/api/notifications/subscribe', { method: 'DELETE', body }));

  it('saves a browser subscription in either payload shape', async () => {
    await post({ subscription: { endpoint: 'https://push/1', keys: { p256dh: 'p', auth: 'a' } } });
    await post({ endpoint: 'https://push/2', p256dh: 'p2', auth: 'a2' });
    expect(notificationDb.savePushSubscription.mock.calls).toEqual([
      ['user-1', { endpoint: 'https://push/1', keys: { p256dh: 'p', auth: 'a' } }],
      ['user-1', { endpoint: 'https://push/2', keys: { p256dh: 'p2', auth: 'a2' } }],
    ]);
  });

  it('rejects incomplete subscriptions', async () => {
    for (const body of [{}, { endpoint: 'e' }, { endpoint: 'e', keys: { p256dh: 'p' } }, { endpoint: 'e', p256dh: 'p' }]) {
      expect((await post(body)).status).toBe(400);
    }
  });

  it('removes a subscription by endpoint', async () => {
    expect((await (await del({ endpoint: 'https://push/1' })).json()).message).toBe('Subscription removed successfully');
    expect(notificationDb.deletePushSubscription).toHaveBeenCalledWith('user-1', 'https://push/1');
    expect((await del({})).status).toBe(400);
  });

  it('guards and reports errors', async () => {
    for (const call of [() => post({ endpoint: 'e', p256dh: 'p', auth: 'a' }), () => del({ endpoint: 'e' })]) {
      requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
      expect((await call()).status).toBe(403);
      applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
      expect((await call()).status).toBe(429);
      await signedOut(call);
    }
    notificationDb.savePushSubscription.mockRejectedValueOnce(new Error('db'));
    expect((await post({ endpoint: 'e', p256dh: 'p', auth: 'a' })).status).toBe(500);
    notificationDb.deletePushSubscription.mockRejectedValueOnce(new Error('db'));
    expect((await del({ endpoint: 'e' })).status).toBe(500);
  });
});

describe('/api/admin/notifications', () => {
  const post = (body: unknown) => admin.POST(makeRequest('/api/admin/notifications', { body }));
  const later = new Date(Date.now() + 3_600_000).toISOString();
  const base = { title: 'Hi', message: 'There', type: 'info', link: '/x' };

  it('GET pages the notification history', async () => {
    adminDb.setTable('Notification', { data: [{ id: 'n' }], count: 3 });
    const body = await (await admin.GET(makeRequest('/api/admin/notifications?limit=500&offset=10'))).json();
    expect(body).toEqual({ success: true, notifications: [{ id: 'n' }], total: 3, limit: 100, offset: 10 });
    expect(adminDb.callsTo('Notification')[0].ops.find((o) => o.op === 'range')?.args).toEqual([10, 109]);
    adminDb.setTable('Notification', { data: null, count: null });
    expect(await (await admin.GET(makeRequest('/api/admin/notifications'))).json()).toMatchObject({ notifications: [], total: 0, limit: 50, offset: 0 });
  });

  it('GET requires an admin and reports errors', async () => {
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await admin.GET(makeRequest('/api/admin/notifications'))).status).toBe(401);
    adminDb.setTable('Notification', { error: { message: 'x' } });
    expect((await admin.GET(makeRequest('/api/admin/notifications'))).status).toBe(500);
  });

  it('POST broadcasts now or later', async () => {
    expect((await (await post(base)).json()).message).toBe('Broadcast notification sent successfully to all users');
    expect(notificationDb.createBroadcast).toHaveBeenCalledWith(base);
    expect((await (await post({ ...base, scheduledAt: later })).json()).message).toMatch(/^Broadcast notification successfully scheduled at/);
    expect(notificationDb.scheduleNotification).toHaveBeenCalledWith({ ...base, targetType: 'broadcast', scheduledAt: later });
  });

  it('POST targets one player by email, now or later', async () => {
    findByEmail.mockResolvedValue({ id: 'u9' });
    expect((await (await post({ ...base, targetType: 'user', targetEmail: 'p@x' })).json()).message).toBe('Notification sent successfully to p@x');
    expect(notificationDb.create).toHaveBeenCalledWith('u9', base);
    await post({ ...base, targetType: 'user', targetEmail: 'p@x', scheduledAt: later });
    expect(notificationDb.scheduleNotification).toHaveBeenCalledWith({ ...base, targetType: 'user', targetUserId: 'u9', scheduledAt: later });
    findByEmail.mockResolvedValue(null);
    expect((await post({ ...base, targetType: 'user', targetEmail: 'ghost@x' })).status).toBe(404);
    expect((await post({ ...base, targetType: 'user' })).status).toBe(400);
  });

  it('POST validates the fields and the schedule', async () => {
    expect((await post({ title: 'x' })).status).toBe(400);
    expect((await (await post({ ...base, scheduledAt: 'not a date' })).json()).message).toBe('Invalid scheduled date/time');
    expect((await (await post({ ...base, scheduledAt: new Date(Date.now() - 1000).toISOString() })).json()).message).toBe('Scheduled time must be in the future');
  });

  it('POST guards and reports errors', async () => {
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post(base)).status).toBe(403);
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await post(base)).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await post(base)).status).toBe(429);
    expect(applyRateLimit).toHaveBeenLastCalledWith('admin', expect.anything(), 'boss@example.test', '/api/admin/notifications');
    notificationDb.createBroadcast.mockRejectedValueOnce(new Error('push'));
    expect((await post(base)).status).toBe(500);
  });
});
