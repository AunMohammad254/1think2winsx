// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock, type MockResult, type QueryCall } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
let adminDb: SupabaseMock;
let idCounter = 0;
const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
const loggerLog = vi.fn();

vi.mock('@/lib/supabase/db-modules/shared', async () => {
  const real = await vi.importActual<typeof import('@/lib/supabase/db-modules/shared')>('@/lib/supabase/db-modules/shared');
  return { ...real, getDb: async () => db.client, getAdminDb: () => adminDb.client, generateId: () => `id-${++idCounter}` };
});
vi.mock('web-push', () => ({ default: { sendNotification: (...a: unknown[]) => sendNotification(...a), setVapidDetails: (...a: unknown[]) => setVapidDetails(...a) } }));
vi.mock('@/lib/logger', () => ({ default: { log: (...a: unknown[]) => loggerLog(...a) } }));

const { quizDb, questionDb, quizAttemptDb, questionAttemptDb } = await import('@/lib/supabase/db-modules/quiz.db');
const { prizeDb, prizeRedemptionDb } = await import('@/lib/supabase/db-modules/prize.db');
const { userDb } = await import('@/lib/supabase/db-modules/user.db');
const { newsletterDb } = await import('@/lib/supabase/db-modules/newsletter.db');
const { quizWinnerDb } = await import('@/lib/supabase/db-modules/winner.db');
const { streamConfigDb } = await import('@/lib/supabase/db-modules/stream.db');
const { notificationDb } = await import('@/lib/supabase/db-modules/notification.db');

const both = (result: MockResult) => {
  db.setTable('*', result);
  adminDb.setTable('*', result);
};
const allCalls = () => [...db.calls, ...adminDb.calls];
const lastCall = () => allCalls().at(-1)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  db = createSupabaseMock();
  adminDb = createSupabaseMock();
  idCounter = 0;
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
  loggerLog.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// [name, call, value returned on success when every query yields { data: ROW, count: 3 }]
const ROW = { id: 'row' };
const simple: [string, () => Promise<unknown>, unknown][] = [
  ['quizDb.findMany', () => quizDb.findMany(), ROW],
  ['quizDb.findById', () => quizDb.findById('q'), ROW],
  ['quizDb.findByIdWithQuestions', () => quizDb.findByIdWithQuestions('q'), ROW],
  ['quizDb.create', () => quizDb.create({ title: 't' } as never), ROW],
  ['quizDb.update', () => quizDb.update('q', { title: 't' } as never), ROW],
  ['quizDb.delete', () => quizDb.delete('q'), undefined],
  ['quizDb.count', () => quizDb.count(), 3],
  ['questionDb.findByQuizId', () => questionDb.findByQuizId('q'), ROW],
  ['questionDb.findById', () => questionDb.findById('x'), ROW],
  ['questionDb.create', () => questionDb.create({ text: 't' } as never), ROW],
  ['questionDb.createMany', () => questionDb.createMany([{ text: 'a' } as never]), ROW],
  ['questionDb.update', () => questionDb.update('x', {} as never), ROW],
  ['questionDb.delete', () => questionDb.delete('x'), undefined],
  ['questionDb.setCorrectAnswer', () => questionDb.setCorrectAnswer('x', 2), ROW],
  ['quizAttemptDb.findByUserId', () => quizAttemptDb.findByUserId('u'), ROW],
  ['quizAttemptDb.findByUserAndQuiz', () => quizAttemptDb.findByUserAndQuiz('u', 'q'), ROW],
  ['quizAttemptDb.findById', () => quizAttemptDb.findById('a'), ROW],
  ['quizAttemptDb.findByIdWithAnswers', () => quizAttemptDb.findByIdWithAnswers('a'), ROW],
  ['quizAttemptDb.create', () => quizAttemptDb.create({} as never), ROW],
  ['quizAttemptDb.update', () => quizAttemptDb.update('a', {} as never), ROW],
  ['quizAttemptDb.complete', () => quizAttemptDb.complete('a', 80, 8), ROW],
  ['questionAttemptDb.findByUserAndQuiz', () => questionAttemptDb.findByUserAndQuiz('u', 'q'), ROW],
  ['questionAttemptDb.createMany', () => questionAttemptDb.createMany([{ userId: 'u', questionId: 'x', quizId: 'q', selectedOption: 1, isCorrect: true, attemptedAt: new Date(0) }]), ROW],
  ['prizeDb.findMany', () => prizeDb.findMany(), ROW],
  ['prizeDb.findById', () => prizeDb.findById('p'), ROW],
  ['prizeDb.findByIdAdmin', () => prizeDb.findByIdAdmin('p'), ROW],
  ['prizeDb.create', () => prizeDb.create({} as never), ROW],
  ['prizeDb.update', () => prizeDb.update('p', {} as never), ROW],
  ['prizeDb.delete', () => prizeDb.delete('p'), undefined],
  ['prizeRedemptionDb.findByUserId', () => prizeRedemptionDb.findByUserId('u'), ROW],
  ['prizeRedemptionDb.findPending', () => prizeRedemptionDb.findPending(), ROW],
  ['prizeRedemptionDb.findById', () => prizeRedemptionDb.findById('r'), ROW],
  ['prizeRedemptionDb.create', () => prizeRedemptionDb.create({} as never), ROW],
  ['prizeRedemptionDb.updateStatus', () => prizeRedemptionDb.updateStatus('r', 'approved', 'ok'), ROW],
  ['userDb.findByEmail', () => userDb.findByEmail('e'), ROW],
  ['userDb.findById', () => userDb.findById('u'), ROW],
  ['userDb.create', () => userDb.create({} as never), ROW],
  ['userDb.update', () => userDb.update('u', {} as never), ROW],
  ['userDb.updateByEmail', () => userDb.updateByEmail('e', {} as never), ROW],
  ['userDb.delete', () => userDb.delete('u'), undefined],
  ['userDb.count', () => userDb.count(), 3],
  ['userDb.getLeaderboard', () => userDb.getLeaderboard(), ROW],
  ['userDb.findByPhone', () => userDb.findByPhone('03001234567'), ROW],
  ['quizWinnerDb.findByQuizId', () => quizWinnerDb.findByQuizId('q'), ROW],
  ['quizWinnerDb.existsForQuiz', () => quizWinnerDb.existsForQuiz('q'), true],
  ['quizWinnerDb.create', () => quizWinnerDb.create({} as never), ROW],
  ['quizWinnerDb.markNotificationSent', () => quizWinnerDb.markNotificationSent('w'), ROW],
  ['quizWinnerDb.linkRedemption', () => quizWinnerDb.linkRedemption('w', 'r'), ROW],
  ['quizWinnerDb.findMany', () => quizWinnerDb.findMany(), ROW],
  ['streamConfigDb.findDefault', () => streamConfigDb.findDefault(), ROW],
  ['streamConfigDb.findActive', () => streamConfigDb.findActive(), ROW],
  ['streamConfigDb.findAll', () => streamConfigDb.findAll(), ROW],
  ['streamConfigDb.create', () => streamConfigDb.create({} as never), ROW],
  ['streamConfigDb.update', () => streamConfigDb.update('s', {} as never), ROW],
  ['notificationDb.getUserNotifications', () => notificationDb.getUserNotifications('u'), ROW],
  ['notificationDb.getUnreadCount', () => notificationDb.getUnreadCount('u'), 3],
  ['notificationDb.markAsRead', () => notificationDb.markAsRead('n', 'u'), undefined],
  ['notificationDb.markAllAsRead', () => notificationDb.markAllAsRead('u'), undefined],
  ['notificationDb.savePushSubscription', () => notificationDb.savePushSubscription('u', { endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }), ROW],
  ['notificationDb.deletePushSubscription', () => notificationDb.deletePushSubscription('u', 'e'), undefined],
  ['notificationDb.scheduleNotification', () => notificationDb.scheduleNotification({ title: 't', message: 'm', type: 'x', targetType: 'all', scheduledAt: '2026-01-01T00:00:00Z' }), ROW],
  ['notificationDb.deleteNotification', () => notificationDb.deleteNotification('n', 'u'), undefined],
  ['notificationDb.deleteAllNotifications', () => notificationDb.deleteAllNotifications('u'), undefined],
];

describe('db modules: every simple operation', () => {
  it.each(simple)('%s returns the query result', async (_name, call, expected) => {
    const isList = (fn: string) => /find(Many|All|Pending|ByUserId|ByQuizId|ByAttemptId)|createMany|getLeaderboard|getUserNotifications|questionAttemptDb\.findByUserAndQuiz/.test(fn);
    both({ data: isList(_name) ? [ROW] : ROW, count: 3 });
    const result = await call();
    expect(result).toEqual(isList(_name) && expected === ROW ? [ROW] : expected);
  });

  it.each(simple)('%s rethrows a database error', async (_name, call) => {
    both({ error: { code: '500', message: 'db down' } });
    await expect(call()).rejects.toEqual({ code: '500', message: 'db down' });
  });

  it.each(simple.filter(([n]) => /find|getLeaderboard|getUserNotifications/.test(n) && !/ById$|ByIdAdmin$|ByQuizId$|Default$|Active$|ByEmail$|ByPhone$|WithQuestions$|UserAndQuiz$|existsForQuiz/.test(n)))(
    '%s returns [] when there are no rows',
    async (_name, call) => {
      both({ data: null });
      expect(await call()).toEqual(_name === 'quizAttemptDb.findByIdWithAnswers' ? null : []);
    },
  );

  it.each(simple.filter(([n]) => /\.find\w*(ById|ByIdAdmin|ByQuizId|Default|Active|ByEmail|ByPhone|WithQuestions)$/.test(n) && n !== 'questionDb.findByQuizId'))(
    '%s treats PGRST116 as "not found"',
    async (_name, call) => {
      both({ data: null, error: { code: 'PGRST116' } });
      if (_name === 'quizAttemptDb.findByIdWithAnswers') return;
      expect(await call()).toBeNull();
    },
  );
});

describe('creating rows in tables that came from Prisma', () => {
  // These tables have a NOT NULL "updatedAt" with no default (Prisma used to fill it in), so an insert
  // without one is refused. Creating a prize failed this way in production on 2026-10-19.
  it.each([
    ['prizeDb.create', () => prizeDb.create({ name: 'Bike' } as never)],
    ['prizeRedemptionDb.create', () => prizeRedemptionDb.create({} as never)],
    ['quizAttemptDb.create', () => quizAttemptDb.create({} as never)],
    ['userDb.create', () => userDb.create({} as never)],
    ['streamConfigDb.create', () => streamConfigDb.create({} as never)],
    ['quizDb.create', () => quizDb.create({ title: 't' } as never)],
    ['questionDb.create', () => questionDb.create({ text: 't' } as never)],
  ])('%s sends updatedAt', async (_name, call) => {
    both({ data: ROW });
    await call();
    const row = argOf(lastCall(), 'insert') as Record<string, unknown>;
    expect(Date.parse(row.updatedAt as string)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('gives a new prize matching created and updated times, and keeps what the caller sent', async () => {
    both({ data: ROW });
    await prizeDb.create({ name: 'Bike', pointsRequired: 500 } as never);
    const row = argOf(lastCall(), 'insert') as Record<string, unknown>;
    expect(row).toMatchObject({ id: 'id-1', name: 'Bike', pointsRequired: 500 });
    expect(row.createdAt).toBe(row.updatedAt);
  });
});

describe('quiz.db specifics', () => {
  it('list reads and bulk inserts return [] when Supabase sends no rows', async () => {
    both({ data: null });
    expect(await questionDb.findByQuizId('q')).toEqual([]);
    expect(await questionDb.createMany([{ quizId: 'q' } as never])).toEqual([]);
    expect(await questionAttemptDb.findByUserAndQuiz('u', 'q')).toEqual([]);
  });

  it('findMany filters, orders and pages', async () => {
    both({ data: [] });
    await quizDb.findMany({ status: 'active', limit: 5, offset: 10, orderBy: 'title', orderDir: 'asc' });
    const call = lastCall();
    expect(eqValue(call, 'status')).toBe('active');
    expect(eqValue(call, 'freeEntry')).toBeUndefined();
    expect(call.ops.find((o) => o.op === 'order')?.args).toEqual(['title', { ascending: true }]);
    expect(argOf(call, 'limit')).toBe(5);
    expect(call.ops.find((o) => o.op === 'range')?.args).toEqual([10, 14]);
    await quizDb.findMany({ freeEntry: false });
    expect(eqValue(lastCall(), 'freeEntry')).toBe(false);
    await quizDb.findMany({ offset: 3 });
    expect(lastCall().ops.find((o) => o.op === 'range')?.args).toEqual([3, 12]);
    expect(lastCall().ops.find((o) => o.op === 'order')?.args).toEqual(['createdAt', { ascending: false }]);
  });

  it('count can filter by status and defaults to 0', async () => {
    both({ count: null });
    expect(await quizDb.count('active')).toBe(0);
    expect(eqValue(lastCall(), 'status')).toBe('active');
  });

  it('findByIdWithQuestions never selects the answer key', async () => {
    both({ data: null });
    expect(await quizDb.findByIdWithQuestions('q')).toBeNull();
    expect(argOf(lastCall(), 'select')).not.toContain('correctOption');
  });

  it('createMany gives each row an id; setCorrectAnswer flags the question as answered', async () => {
    both({ data: [] });
    await questionDb.createMany([{ text: 'a' } as never, { text: 'b' } as never]);
    expect((argOf(lastCall(), 'insert') as { id: string }[]).map((q) => q.id)).toEqual(['id-1', 'id-2']);
    both({ data: {} });
    await questionDb.setCorrectAnswer('x', 3);
    expect(argOf(lastCall(), 'update')).toMatchObject({ correctOption: 3, hasCorrectAnswer: true });
    await quizAttemptDb.complete('a', 70, 7);
    expect(argOf(lastCall(), 'update')).toMatchObject({ score: 70, points: 7, isCompleted: true });
  });

  it('questionAttemptDb.createMany serialises the attempt time', async () => {
    both({ data: null });
    expect(await questionAttemptDb.createMany([{ userId: 'u', questionId: 'x', quizId: 'q', selectedOption: 1, isCorrect: false, attemptedAt: new Date('2026-01-01T00:00:00Z') }])).toEqual([]);
    expect((argOf(lastCall(), 'insert') as Record<string, unknown>[])[0]).toMatchObject({ id: 'id-1', attemptedAt: '2026-01-01T00:00:00.000Z', isCorrect: false });
  });
});

describe('prize.db specifics', () => {
  it('findMany filters on an explicit isActive, including false, and on status', async () => {
    both({ data: [] });
    await prizeDb.findMany({ isActive: false, status: 'draft' });
    expect(eqValue(lastCall(), 'isActive')).toBe(false);
    expect(eqValue(lastCall(), 'status')).toBe('draft');
  });

  it('decrementStock is atomic and reports an empty stock', async () => {
    adminDb.setRpc('decrement_prize_stock', { data: 4 });
    expect(await prizeDb.decrementStock('p')).toBe(4);
    adminDb.setRpc('decrement_prize_stock', { error: { code: 'P0001' } });
    await expect(prizeDb.decrementStock('p')).rejects.toThrow('Prize out of stock');
    adminDb.setRpc('decrement_prize_stock', { error: { code: '500' } });
    await expect(prizeDb.decrementStock('p')).rejects.toEqual({ code: '500' });
  });

  it('findAllAdmin pages with a total', async () => {
    both({ data: [ROW], count: 45 });
    expect(await prizeRedemptionDb.findAllAdmin({ status: 'pending', page: 3, limit: 10 })).toEqual({ data: [ROW], count: 45, page: 3, limit: 10, totalPages: 5 });
    expect(lastCall().ops.find((o) => o.op === 'range')?.args).toEqual([20, 29]);
    both({ data: null, count: null });
    expect(await prizeRedemptionDb.findAllAdmin()).toEqual({ data: [], count: 0, page: 1, limit: 20, totalPages: 0 });
    both({ error: { message: 'x' } });
    await expect(prizeRedemptionDb.findAllAdmin()).rejects.toBeTruthy();
  });

  it('countByStatus counts every status with head-only queries', async () => {
    const counts: Record<string, number | null> = { pending: 3, approved: 5, fulfilled: null, rejected: 1 };
    adminDb.setTable('PrizeRedemption', (call) => ({ count: counts[eqValue(call, 'status') as string] }));
    expect(await prizeRedemptionDb.countByStatus()).toEqual({ pending: 3, approved: 5, fulfilled: 0, rejected: 1 });
    expect(adminDb.callsTo('PrizeRedemption').map((c) => argOf(c, 'select'))).toEqual(['id', 'id', 'id', 'id']);
    expect(adminDb.calls[0].ops.find((o) => o.op === 'select')?.args[1]).toEqual({ count: 'exact', head: true });
    adminDb.setTable('PrizeRedemption', { error: { message: 'x' } });
    await expect(prizeRedemptionDb.countByStatus()).rejects.toEqual({ message: 'x' });
  });
});

describe('user.db specifics', () => {
  it.each([
    ['03001234567', undefined, ['03001234567', '+923001234567']],
    ['+923001234567', undefined, ['+923001234567', '03001234567']],
    ['3001234567', '+923001234567', ['3001234567', '+923001234567']],
    ['03001234567', '03001234567', ['03001234567', '+923001234567']],
  ])('findByPhone(%s, %s) searches %j', async (phone, normalized, variants) => {
    both({ data: null });
    await userDb.findByPhone(phone, normalized);
    expect(lastCall().ops.find((o) => o.op === 'in')?.args).toEqual(['phone', variants]);
  });

  it('points and wallet changes go through atomic RPCs', async () => {
    adminDb.setRpc('increment_user_points', { data: 15 });
    adminDb.setRpc('increment_user_wallet', { data: 100 });
    expect(await userDb.addPoints('u', 5)).toBe(15);
    expect(await userDb.updateWalletBalance('u', -2)).toBe(100);
    expect(adminDb.rpcCalls).toEqual([
      { fn: 'increment_user_points', args: { p_user_id: 'u', p_delta: 5 } },
      { fn: 'increment_user_wallet', args: { p_user_id: 'u', p_delta: -2 } },
    ]);
    adminDb.setRpc('increment_user_points', { error: { message: 'x' } });
    adminDb.setRpc('increment_user_wallet', { error: { message: 'x' } });
    await expect(userDb.addPoints('u', 1)).rejects.toBeTruthy();
    await expect(userDb.updateWalletBalance('u', 1)).rejects.toBeTruthy();
  });

  it('count and leaderboard handle empty results', async () => {
    both({ data: null, count: null });
    expect(await userDb.count()).toBe(0);
    expect(await userDb.getLeaderboard(3)).toEqual([]);
    expect(argOf(lastCall(), 'limit')).toBe(3);
  });
});

describe('winner.db specifics', () => {
  it('existsForQuiz is false without a row; findMany pages', async () => {
    both({ data: null });
    expect(await quizWinnerDb.existsForQuiz('q')).toBe(false);
    both({ data: null, error: { code: 'PGRST116' } });
    expect(await quizWinnerDb.existsForQuiz('q')).toBe(false);
    both({ data: [] });
    await quizWinnerDb.findMany({ limit: 5, offset: 5 });
    expect(lastCall().ops.find((o) => o.op === 'range')?.args).toEqual([5, 9]);
  });
});

describe('newsletter.db', () => {
  it('subscribes new and repeat addresses', async () => {
    expect(await newsletterDb.subscribeEmail('a@b.c')).toEqual({ success: true, isNew: true, message: 'Subscribed successfully!' });
    both({ error: { code: '23505' } });
    expect(await newsletterDb.subscribeEmail('a@b.c')).toEqual({ success: true, isNew: false, message: 'You are already subscribed!' });
    both({ error: { code: '500', message: 'down' } });
    expect(await newsletterDb.subscribeEmail('a@b.c')).toEqual({ success: false, message: 'Failed to subscribe', error: 'down' });
  });

  it('reads every subscriber page by page', async () => {
    adminDb.setTable('NewsletterSubscription', [{ data: [{ id: '1', email: 'a@x' }, { id: '2', email: 'b@x' }] }, { data: [] }]);
    expect(await newsletterDb.getSubscribers()).toEqual(['a@x', 'b@x']);
    expect(adminDb.calls[1].ops.find((o) => o.op === 'gt')?.args).toEqual(['id', '2']);
    adminDb.setTable('NewsletterSubscription', { error: { message: 'x' } });
    expect(await newsletterDb.getSubscribers()).toEqual([]);
  });

  it('unsubscribes', async () => {
    expect(await newsletterDb.unsubscribeEmail('a@x')).toBe(true);
    both({ error: { message: 'x' } });
    expect(await newsletterDb.unsubscribeEmail('a@x')).toBe(false);
  });
});

describe('notification.db push delivery', () => {
  const sub = (id: string) => ({ id, userId: 'u', endpoint: `https://push.example/${id}`, p256dh: 'p', auth: 'a', createdAt: 'c' });

  it('create stores the notification and pushes to every device of the player', async () => {
    adminDb.setTable('Notification', { data: { id: 'n1' } });
    adminDb.setTable('PushSubscription', { data: [sub('s1'), sub('s2')] });

    expect(await notificationDb.create('u', { title: 'Hi', message: 'There', type: 'wallet', link: '/w' })).toEqual({ id: 'n1' });
    await flush();

    expect(argOf(adminDb.callsTo('Notification')[0], 'insert')).toMatchObject({ userId: 'u', title: 'Hi', message: 'There', link: '/w', read: false });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [target, payload, opts] = sendNotification.mock.calls[0];
    expect(target).toEqual({ endpoint: 'https://push.example/s1', keys: { p256dh: 'p', auth: 'a' } });
    expect(JSON.parse(payload)).toMatchObject({ title: 'Hi', body: 'There', url: '/w', tag: 'wallet', renotify: true });
    expect(opts).toEqual({ timeout: 10_000 });
  });

  it('create defaults the link and skips push without subscriptions', async () => {
    adminDb.setTable('Notification', { data: { id: 'n1' } });
    adminDb.setTable('PushSubscription', { data: [sub('s1')] });
    await notificationDb.create('u', { title: 't', message: 'm', type: 'x' });
    await flush();
    expect(argOf(adminDb.callsTo('Notification')[0], 'insert')).toMatchObject({ link: null });
    expect(JSON.parse(sendNotification.mock.calls[0][1]).url).toBe('/notifications');

    sendNotification.mockClear();
    adminDb.setTable('PushSubscription', { data: [] });
    await notificationDb.create('u', { title: 't', message: 'm', type: 'x' });
    adminDb.setTable('PushSubscription', { data: null });
    await notificationDb.create('u', { title: 't', message: 'm', type: 'x' });
    await flush();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('deletes subscriptions the push service says are gone, and logs other failures', async () => {
    adminDb.setTable('Notification', { data: { id: 'n1' } });
    adminDb.setTable('PushSubscription', (call) => (call.ops.some((o) => o.op === 'delete') ? { error: null } : { data: [sub('gone'), sub('missing'), sub('flaky')] }));
    sendNotification.mockImplementation(async (target: { endpoint: string }) => {
      if (target.endpoint.endsWith('gone')) throw { statusCode: 410 };
      if (target.endpoint.endsWith('missing')) throw { statusCode: 404 };
      throw { statusCode: 500 };
    });

    await notificationDb.create('u', { title: 't', message: 'm', type: 'x' });
    await flush();

    const deletes = adminDb.callsTo('PushSubscription', 'delete');
    expect(deletes.map((c) => eqValue(c, 'id'))).toEqual(['gone', 'missing']);
    expect(loggerLog).toHaveBeenCalledWith(expect.stringContaining('(410)'));
    expect(console.error).toHaveBeenCalledWith('[Web Push] Failed to send push notification:', { statusCode: 500 });
  });

  it('logs when removing a dead subscription fails', async () => {
    adminDb.setTable('Notification', { data: { id: 'n1' } });
    adminDb.setTable('PushSubscription', { data: [sub('gone')] });
    sendNotification.mockRejectedValue({ statusCode: 410 });
    adminDb.setTable('PushSubscription', (call) => {
      if (call.ops.some((o) => o.op === 'delete')) throw new Error('delete failed');
      return { data: [sub('gone')] };
    });
    await notificationDb.create('u', { title: 't', message: 'm', type: 'x' });
    await flush();
    expect(console.error).toHaveBeenCalledWith('[Web Push] Failed to delete expired subscription:', expect.any(Error));
  });

  it('create throws when the insert fails', async () => {
    adminDb.setTable('Notification', { error: { message: 'insert failed' } });
    await expect(notificationDb.create('u', { title: 't', message: 'm', type: 'x' })).rejects.toEqual({ message: 'insert failed' });
  });

  // These two run the old path: the database has no broadcast_create yet (before migration 20261113120000)
  const legacyDatabase = () => adminDb.setRpc('broadcast_create', { error: { code: 'PGRST202', message: 'Could not find the function' } });

  it('createBroadcast inserts for every user in chunks of 500 and pushes in batches of 50', async () => {
    legacyDatabase();
    const users = Array.from({ length: 1200 }, (_, i) => ({ id: `u${String(i).padStart(4, '0')}` }));
    const subs = Array.from({ length: 120 }, (_, i) => sub(`s${String(i).padStart(3, '0')}`));
    adminDb.setTable('User', [{ data: users.slice(0, 1000) }, { data: users.slice(1000) }, { data: [] }]);
    adminDb.setTable('Notification', { error: null });
    adminDb.setTable('PushSubscription', [{ data: subs }, { data: [] }]);

    await notificationDb.createBroadcast({ title: 'All', message: 'Hello', type: 'broadcast' });
    await flush();
    await flush();

    const inserts = adminDb.callsTo('Notification', 'insert').map((c) => (argOf(c, 'insert') as unknown[]).length);
    expect(inserts).toEqual([500, 500, 200]);
    expect(sendNotification).toHaveBeenCalledTimes(120);
  });

  it('createBroadcast stops for no users, throws on insert errors, and survives a failed subscription read', async () => {
    legacyDatabase();
    adminDb.setTable('User', { data: [] });
    await notificationDb.createBroadcast({ title: 't', message: 'm', type: 'x' });
    expect(adminDb.callsTo('Notification')).toHaveLength(0);

    adminDb.setTable('User', [{ data: [{ id: 'u1' }] }, { data: [] }]);
    adminDb.setTable('Notification', { error: { message: 'insert failed' } });
    await expect(notificationDb.createBroadcast({ title: 't', message: 'm', type: 'x' })).rejects.toEqual({ message: 'insert failed' });

    adminDb.setTable('User', [{ data: [{ id: 'u1' }] }, { data: [] }]);
    adminDb.setTable('Notification', { error: null });
    adminDb.setTable('PushSubscription', { error: { message: 'cannot read' } });
    await notificationDb.createBroadcast({ title: 't', message: 'm', type: 'x', link: '/x' });
    expect(console.error).toHaveBeenCalledWith('[Web Push] Failed to load push subscriptions for broadcast:', { message: 'cannot read' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  describe('createBroadcast as a job (migration 20261113120000)', () => {
    const subs = (from: number, n: number) => Array.from({ length: n }, (_, i) => sub(`s${String(from + i).padStart(5, '0')}`));
    const claimed = (over: Record<string, unknown> = {}) =>
      ({ id: 'b1', token: 't1', status: 'inserting', title: 'Live now', message: 'Go', type: 'quiz_live', link: '/quizzes?openQuiz=q', pushCursor: null, ...over });
    /** broadcast_claim answers these in turn, then nothing is due */
    const claims = (...rows: unknown[]) => {
      let i = 0;
      adminDb.setRpc('broadcast_claim', () => ({ data: rows[i++] ?? null }));
    };
    const rpcNames = () => adminDb.rpcCalls.map((c) => c.fn);
    const afterId = (call: QueryCall) => (call.ops.find((o) => o.op === 'gt')?.args[1] ?? null);
    const limitOf = (call: QueryCall) => argOf(call, 'limit');
    afterEach(() => {
      delete process.env.BROADCAST_PUSH_WAVE;
      delete process.env.BROADCAST_WAVE_SECONDS;
      delete process.env.FANOUT_V2;
    });

    it('writes one job and returns at once; the notices go in 5,000 at a time, then one wave of pushes', async () => {
      adminDb.setRpc('broadcast_create', { data: { success: true, id: 'b1', duplicate: false } });
      claims(claimed());
      let step = 0;
      adminDb.setRpc('broadcast_insert_users', () => ({ data: [{ success: true, inserted: 5000, done: false }, { success: true, inserted: 1200, done: true }][step++] }));
      adminDb.setRpc('broadcast_wave_done', { data: { success: true } });
      adminDb.setTable('PushSubscription', { data: subs(0, 120) });

      expect(await notificationDb.createBroadcast({ title: 'Live now', message: 'Go', type: 'quiz_live', link: '/quizzes?openQuiz=q' }))
        .toEqual({ id: 'b1', duplicate: false, queued: true });
      expect(adminDb.rpcCalls[0]).toEqual({ fn: 'broadcast_create', args: { p_title: 'Live now', p_message: 'Go', p_type: 'quiz_live', p_link: '/quizzes?openQuiz=q' } });
      for (let i = 0; i < 6; i++) await flush();

      expect(rpcNames()).toEqual(['broadcast_create', 'broadcast_claim', 'broadcast_insert_users', 'broadcast_insert_users', 'broadcast_wave_done', 'broadcast_claim']);
      expect(adminDb.rpcCalls[2].args).toEqual({ p_id: 'b1', p_limit: 5000 });
      // Nothing is read into the web process: the database adds the notices itself
      expect(adminDb.callsTo('User')).toHaveLength(0);
      expect(adminDb.callsTo('Notification')).toHaveLength(0);
      expect(sendNotification).toHaveBeenCalledTimes(120);
      expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({ title: 'Live now', body: 'Go', url: '/quizzes?openQuiz=q', tag: 'quiz_live', renotify: true });
      expect(adminDb.rpcCalls[4].args).toEqual({ p_id: 'b1', p_token: 't1', p_cursor: 's00119', p_sent: 120, p_last: true, p_next_wave_seconds: 60 });
      expect(loggerLog).toHaveBeenCalledWith('[Broadcast] b1: 120 pushes in this wave, all sent');
    });

    it('refuses the same broadcast within 15 minutes, and sends nothing for it', async () => {
      adminDb.setRpc('broadcast_create', { data: { success: true, id: 'b1', duplicate: true } });
      expect(await notificationDb.createBroadcast({ title: 'Live now', message: 'Go', type: 'quiz_live' })).toEqual({ id: 'b1', duplicate: true, queued: true });
      await flush();
      expect(rpcNames()).toEqual(['broadcast_create']);
      expect(adminDb.rpcCalls[0].args.p_link).toBeNull();
      expect(loggerLog).toHaveBeenCalledWith('[Broadcast] "Live now" was already sent in the last 15 minutes (b1): not sent again');
    });

    it('throws when the database refuses or fails, and keeps the request alive when sending fails later', async () => {
      adminDb.setRpc('broadcast_create', { data: { success: false, error: 'A broadcast needs a title, a message and a type' } });
      await expect(notificationDb.createBroadcast({ title: ' ', message: 'm', type: 'x' })).rejects.toThrow('A broadcast needs a title');
      adminDb.setRpc('broadcast_create', { data: null });
      await expect(notificationDb.createBroadcast({ title: 't', message: 'm', type: 'x' })).rejects.toThrow('The broadcast was refused');
      adminDb.setRpc('broadcast_create', { error: { code: '57014', message: 'canceling statement' } });
      await expect(notificationDb.createBroadcast({ title: 't', message: 'm', type: 'x' })).rejects.toEqual({ code: '57014', message: 'canceling statement' });

      adminDb.setRpc('broadcast_create', { data: { success: true, id: 'b2', duplicate: false } });
      adminDb.setRpc('broadcast_claim', { error: { code: '08006', message: 'connection lost' } });
      expect((await notificationDb.createBroadcast({ title: 't', message: 'm', type: 'x' })).queued).toBe(true);
      await flush();
      await flush();
      expect(console.error).toHaveBeenCalledWith('[Broadcast] Sending stopped; the minute cron resumes it:', { code: '08006', message: 'connection lost' });
    });

    it('does the whole job in the request with FANOUT_V2=false', async () => {
      process.env.FANOUT_V2 = 'false';
      adminDb.setTable('User', [{ data: [{ id: 'u1' }] }, { data: [] }]);
      adminDb.setTable('Notification', { error: null });
      adminDb.setTable('PushSubscription', { data: [] });
      expect(await notificationDb.createBroadcast({ title: 't', message: 'm', type: 'x' })).toEqual({ id: null, duplicate: false, queued: false });
      expect(rpcNames()).toEqual([]);
      expect(adminDb.callsTo('Notification', 'insert')).toHaveLength(1);
    });

    it('pushes in waves of BROADCAST_PUSH_WAVE from the cursor, pages of 1,000, and finishes on a short page', async () => {
      process.env.BROADCAST_PUSH_WAVE = '1500';
      process.env.BROADCAST_WAVE_SECONDS = '30';
      // Without a link a push opens the notifications page
      claims(claimed({ status: 'pushing', pushCursor: 's00099', link: null }), claimed({ status: 'pushing', pushCursor: 's01599', token: 't2', link: null }));
      adminDb.setRpc('broadcast_wave_done', { data: { success: true } });
      let page = 0;
      adminDb.setTable('PushSubscription', () => ({ data: [subs(100, 1000), subs(1100, 500), subs(1600, 7)][page++] }));

      expect(await notificationDb.advanceBroadcasts()).toEqual({ broadcasts: ['b1', 'b1'], inserted: 0, pushed: 1507 });
      const reads = adminDb.callsTo('PushSubscription');
      expect(reads.map(afterId)).toEqual(['s00099', 's01099', 's01599']);
      expect(reads.map(limitOf)).toEqual([1000, 500, 1000]);
      const waves = adminDb.rpcCalls.filter((c) => c.fn === 'broadcast_wave_done').map((c) => c.args);
      expect(waves).toEqual([
        { p_id: 'b1', p_token: 't1', p_cursor: 's01599', p_sent: 1500, p_last: false, p_next_wave_seconds: 30 },
        { p_id: 'b1', p_token: 't2', p_cursor: 's01606', p_sent: 7, p_last: true, p_next_wave_seconds: 30 },
      ]);
      expect(loggerLog).toHaveBeenCalledWith('[Broadcast] b1: 1500 pushes in this wave');
      expect(JSON.parse(sendNotification.mock.calls[0][1]).url).toBe('/notifications');
    });

    it('ends a broadcast with no devices left, keeping its cursor, and reads defaults from bad settings', async () => {
      process.env.BROADCAST_PUSH_WAVE = 'many';
      claims(claimed({ status: 'pushing', pushCursor: 's00005' }));
      adminDb.setRpc('broadcast_wave_done', { data: { success: true } });
      adminDb.setTable('PushSubscription', { data: null });
      expect(await notificationDb.advanceBroadcasts()).toEqual({ broadcasts: ['b1'], inserted: 0, pushed: 0 });
      expect(limitOf(adminDb.callsTo('PushSubscription')[0])).toBe(1000);
      expect(adminDb.rpcCalls.find((c) => c.fn === 'broadcast_wave_done')!.args).toMatchObject({ p_cursor: 's00005', p_sent: 0, p_last: true });
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('stops quietly before the migration, and throws what the database refuses', async () => {
      adminDb.setRpc('broadcast_claim', { error: { code: 'PGRST202', message: 'Could not find the function' } });
      expect(await notificationDb.advanceBroadcasts()).toEqual({ broadcasts: [], inserted: 0, pushed: 0 });

      claims(claimed());
      adminDb.setRpc('broadcast_insert_users', { error: { code: '57014', message: 'canceling statement' } });
      await expect(notificationDb.advanceBroadcasts()).rejects.toEqual({ code: '57014', message: 'canceling statement' });
      claims(claimed());
      adminDb.setRpc('broadcast_insert_users', { data: { success: false, code: 'not_found' } });
      await expect(notificationDb.advanceBroadcasts()).rejects.toThrow('Broadcast b1 could not add its notices');
      claims(claimed());
      adminDb.setRpc('broadcast_insert_users', { data: { success: true, done: true } });
      adminDb.setTable('PushSubscription', { error: { message: 'cannot read' } });
      await expect(notificationDb.advanceBroadcasts()).rejects.toEqual({ message: 'cannot read' });
      claims(claimed({ status: 'pushing' }));
      adminDb.setTable('PushSubscription', { data: [] });
      adminDb.setRpc('broadcast_wave_done', { error: { message: 'lost' } });
      await expect(notificationDb.advanceBroadcasts()).rejects.toEqual({ message: 'lost' });
      // No wave was recorded for any of them: each lease runs out and the next run starts where it stopped
    });

    it('hands a broadcast back when its time runs out mid-insert, so the next run carries on at once', async () => {
      let now = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      claims(claimed());
      adminDb.setRpc('broadcast_insert_users', () => {
        now += 30_000;
        return { data: { success: true, inserted: 5000, done: false } };
      });
      expect(await notificationDb.advanceBroadcasts({ budgetMs: 40_000 })).toEqual({ broadcasts: ['b1'], inserted: 10000, pushed: 0 });
      expect(rpcNames()).toEqual(['broadcast_claim', 'broadcast_insert_users', 'broadcast_insert_users', 'broadcast_release']);
      expect(adminDb.rpcCalls.at(-1)!.args).toEqual({ p_id: 'b1', p_token: 't1' });
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('does nothing with no time to spend', async () => {
      expect(await notificationDb.advanceBroadcasts({ budgetMs: 0 })).toEqual({ broadcasts: [], inserted: 0, pushed: 0 });
      expect(rpcNames()).toEqual([]);
    });
  });

  it('createBatchForUsers looks subscriptions up 120 users at a time', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    adminDb.setTable('Notification', { error: null });
    adminDb.setTable('PushSubscription', (call) => (call.ops.some((o) => o.op === 'gt') ? { data: [] } : { data: [sub(`for-${(call.ops.find((o) => o.op === 'in')!.args[1] as string[])[0]}`)] }));

    await notificationDb.createBatchForUsers(ids, { title: 't', message: 'm', type: 'x', link: '/q' });
    await flush();
    await flush();

    const lookups = adminDb.callsTo('PushSubscription').filter((c) => !c.ops.some((o) => o.op === 'gt'));
    expect(lookups.map((c) => (c.ops.find((o) => o.op === 'in')!.args[1] as string[]).length)).toEqual([120, 120, 10]);
    expect(sendNotification).toHaveBeenCalledTimes(3);
    expect(argOf(adminDb.callsTo('Notification', 'insert')[0], 'insert')).toHaveLength(250);
  });

  it('createBatchForUsers points a notification without a link at /notifications', async () => {
    adminDb.setTable('Notification', { error: null });
    adminDb.setTable('PushSubscription', (call) => (call.ops.some((o) => o.op === 'gt') ? { data: [] } : { data: [sub('only')] }));
    await notificationDb.createBatchForUsers(['u1'], { title: 't', message: 'm', type: 'x' });
    await flush();
    await flush();
    expect(JSON.parse(sendNotification.mock.calls[0][1]).url).toBe('/notifications');
  });

  it('createBatchForUsers ignores an empty list, throws on insert errors and survives lookup failures', async () => {
    await notificationDb.createBatchForUsers([], { title: 't', message: 'm', type: 'x' });
    expect(adminDb.calls).toHaveLength(0);

    adminDb.setTable('Notification', { error: { message: 'insert failed' } });
    await expect(notificationDb.createBatchForUsers(['u1'], { title: 't', message: 'm', type: 'x' })).rejects.toEqual({ message: 'insert failed' });

    adminDb.setTable('Notification', { error: null });
    adminDb.setTable('PushSubscription', { error: { message: 'lookup failed' } });
    await notificationDb.createBatchForUsers(['u1'], { title: 't', message: 'm', type: 'x' });
    expect(console.error).toHaveBeenCalledWith('[Web Push] Failed to load push subscriptions for batch:', { message: 'lookup failed' });
  });

  it("createMany saves every notification in one insert and pushes each one to its own player's devices", async () => {
    adminDb.setTable('Notification', { error: null });
    const device = (id: string, userId: string) => ({ ...sub(id), userId });
    adminDb.setTable('PushSubscription', (call) => (call.ops.some((o) => o.op === 'gt')
      ? { data: [] }
      : { data: [device('u1-phone', 'u1'), device('u1-laptop', 'u1'), device('u2-phone', 'u2'), device('stray', 'someone-else')] }));

    await notificationDb.createMany([
      { userId: 'u1', title: 'Deposit Approved', message: '100 PKR', type: 'wallet_deposit', link: '/profile/wallet' },
      { userId: 'u2', title: 'Deposit Rejected', message: '200 PKR', type: 'wallet_deposit' },
      { userId: 'u1', title: 'Deposit Approved', message: '300 PKR', type: 'wallet_deposit', link: '/profile/wallet' },
    ]);
    await flush();
    await flush();

    const inserts = adminDb.callsTo('Notification', 'insert');
    expect(inserts).toHaveLength(1);
    expect((argOf(inserts[0], 'insert') as Record<string, unknown>[]).map((n) => [n.userId, n.message, n.link, n.read]))
      .toEqual([['u1', '100 PKR', '/profile/wallet', false], ['u2', '200 PKR', null, false], ['u1', '300 PKR', '/profile/wallet', false]]);
    // One subscription lookup for both players
    const lookups = adminDb.callsTo('PushSubscription').filter((c) => !c.ops.some((o) => o.op === 'gt'));
    expect(lookups.map((c) => c.ops.find((o) => o.op === 'in')!.args)).toEqual([['userId', ['u1', 'u2']]]);
    // u1's two devices get both of u1's notifications, u2's device gets u2's, a device of anyone else none
    const pushes = sendNotification.mock.calls.map(([target, payload]) => [target.endpoint, JSON.parse(payload).body, JSON.parse(payload).url]);
    expect(pushes).toHaveLength(5);
    expect(pushes).toEqual(expect.arrayContaining([
      ['https://push.example/u1-phone', '100 PKR', '/profile/wallet'],
      ['https://push.example/u1-laptop', '300 PKR', '/profile/wallet'],
      ['https://push.example/u2-phone', '200 PKR', '/notifications'],
    ]));
    expect(pushes.some(([endpoint]) => endpoint === 'https://push.example/stray')).toBe(false);
  });

  it('createMany ignores an empty list, inserts 500 rows at a time, throws on insert errors and survives lookup failures', async () => {
    await notificationDb.createMany([]);
    expect(adminDb.calls).toHaveLength(0);

    adminDb.setTable('Notification', { error: null });
    adminDb.setTable('PushSubscription', { data: [] });
    await notificationDb.createMany(Array.from({ length: 501 }, (_, i) => ({ userId: `u${i}`, title: 't', message: 'm', type: 'x' })));
    expect(adminDb.callsTo('Notification', 'insert').map((c) => (argOf(c, 'insert') as unknown[]).length)).toEqual([500, 1]);
    expect(sendNotification).not.toHaveBeenCalled();

    adminDb.setTable('Notification', { error: { message: 'insert failed' } });
    await expect(notificationDb.createMany([{ userId: 'u1', title: 't', message: 'm', type: 'x' }])).rejects.toEqual({ message: 'insert failed' });

    adminDb.setTable('Notification', { error: null });
    adminDb.setTable('PushSubscription', { error: { message: 'lookup failed' } });
    await notificationDb.createMany([{ userId: 'u1', title: 't', message: 'm', type: 'x' }]);
    expect(console.error).toHaveBeenCalledWith('[Web Push] Failed to load push subscriptions for notifications:', { message: 'lookup failed' });
  });

  it('savePushSubscription upserts by endpoint; scheduleNotification stores the target', async () => {
    both({ data: ROW });
    await notificationDb.savePushSubscription('u', { endpoint: 'https://e', keys: { p256dh: 'p', auth: 'a' } });
    const save = lastCall();
    expect(argOf(save, 'upsert')).toMatchObject({ userId: 'u', endpoint: 'https://e', p256dh: 'p', auth: 'a' });
    expect(save.ops.find((o) => o.op === 'upsert')?.args[1]).toEqual({ onConflict: 'endpoint' });

    await notificationDb.scheduleNotification({ title: 't', message: 'm', type: 'x', link: '/l', targetType: 'user', targetUserId: 'u9', scheduledAt: '2026-02-01T10:00:00+05:00' });
    expect(argOf(lastCall(), 'insert')).toMatchObject({ link: '/l', targetType: 'user', targetUserId: 'u9', scheduledAt: '2026-02-01T05:00:00.000Z', dispatched: false });
  });

  it('getUserNotifications and getUnreadCount handle empty results', async () => {
    both({ data: null, count: null });
    expect(await notificationDb.getUserNotifications('u', 5)).toEqual([]);
    expect(argOf(lastCall(), 'limit')).toBe(5);
    expect(await notificationDb.getUnreadCount('u')).toBe(0);
  });
});

describe('notification.db VAPID setup', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('configures web-push when keys are present and warns otherwise', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'pub');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv');
    vi.stubEnv('VAPID_SUBJECT', '');
    vi.resetModules();
    setVapidDetails.mockClear();
    await import('@/lib/supabase/db-modules/notification.db');
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:1think2wins@gmail.com', 'pub', 'priv');

    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    vi.resetModules();
    await import('@/lib/supabase/db-modules/notification.db');
    expect(console.warn).toHaveBeenCalledWith('[Web Push] VAPID keys are missing from environment variables.');
  });
});
