// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, argOf, eqValue, hasOp, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const createBroadcast = vi.fn();
const createNotification = vi.fn();
const invalidateQuizCatalog = vi.fn();
const loggerLog = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client, notificationDb: { createBroadcast: (...a: unknown[]) => createBroadcast(...a), create: (...a: unknown[]) => createNotification(...a) } }));
vi.mock('@/lib/quiz-catalog', () => ({ invalidateQuizCatalog: (...a: unknown[]) => invalidateQuizCatalog(...a) }));
vi.mock('@/lib/logger', () => ({ default: { log: (...a: unknown[]) => loggerLog(...a) } }));

const scheduler = await import('@/lib/quiz-scheduler');
const { runScheduledJobs } = await import('@/lib/scheduled-jobs');
const cache = await import('@/lib/quiz-cache');
const validation = await import('@/utils/validation');

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const isClaim = (call: { ops: { op: string }[] }) => hasOp(call, 'update');

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [createBroadcast, createNotification, invalidateQuizCatalog, loggerLog]) fn.mockReset();
  createBroadcast.mockResolvedValue(undefined);
  createNotification.mockResolvedValue({});
  cache.quizListCache.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('activateDueQuizzes', () => {
  it('claims each due quiz with a conditional update and reports the next start', async () => {
    const nextStart = new Date(Date.now() + 3_600_000).toISOString();
    adminDb.setTable('Quiz', (call) => {
      if (isClaim(call)) return eqValue(call, 'id') === 'taken' ? { data: [] } : eqValue(call, 'id') === 'broken' ? { error: { message: 'x' } } : { data: [{ id: eqValue(call, 'id') }] };
      if (call.ops.some((o) => o.op === 'gt')) return { data: [{ startsAt: nextStart }] };
      return { data: [{ id: 'q1', title: 'One' }, { id: 'taken', title: 'Two' }, { id: 'broken', title: 'Three' }] };
    });

    const res = await scheduler.activateDueQuizzes();

    expect(res).toEqual({ activated: [{ id: 'q1', title: 'One' }], nextDueAt: new Date(nextStart).getTime() });
    const claim = adminDb.callsTo('Quiz', 'update')[0];
    expect(argOf(claim, 'update')).toMatchObject({ status: 'active' });
    expect(claim.ops.find((o) => o.op === 'in')?.args).toEqual(['status', ['scheduled', 'upcoming']]);
    expect(console.error).toHaveBeenCalledWith('[QuizScheduler] Failed to activate quiz broken:', { message: 'x' });
  });

  it('handles nothing due and no future quiz, and throws when the read fails', async () => {
    adminDb.setTable('Quiz', { data: null });
    expect(await scheduler.activateDueQuizzes()).toEqual({ activated: [], nextDueAt: null });
    adminDb.setTable('Quiz', [{ data: [{ id: 'q', title: null }] }, { data: null }, { data: [] }]);
    expect((await scheduler.activateDueQuizzes()).activated).toEqual([]);
    adminDb.setTable('Quiz', { error: { message: 'down' } });
    await expect(scheduler.activateDueQuizzes()).rejects.toEqual({ message: 'down' });
  });

  it('broadcastQuizLive announces the quiz with a link that opens it', async () => {
    await scheduler.broadcastQuizLive({ id: 'q1', title: null });
    expect(createBroadcast).toHaveBeenCalledWith({ title: '🔴 Live now', message: '"Challenge" was just pushed (Scheduled) — jump in now!', type: 'quiz_deadline', link: '/quizzes?openQuiz=q1' });
    expect(scheduler.upcomingQuizLink('q9')).toBe('/quizzes?upcoming=q9');
  });
});

describe('runScheduledJobs', () => {
  type Handler = Parameters<SupabaseMock['setTable']>[1];
  function world(over: Partial<Record<'Quiz' | 'Notification' | 'ScheduledNotification' | 'WalletTransaction', Handler>> = {}) {
    adminDb.setTable('Quiz', over.Quiz ?? { data: [] });
    adminDb.setTable('Notification', over.Notification ?? { data: [] });
    adminDb.setTable('ScheduledNotification', over.ScheduledNotification ?? { data: [] });
    adminDb.setTable('WalletTransaction', over.WalletTransaction ?? { data: [] });
  }

  it('does nothing on a quiet tick', async () => {
    world();
    expect(await runScheduledJobs()).toEqual({ processedQuizzes: [], processedNotifications: [], processedStaleDeposits: [] });
    expect(invalidateQuizCatalog).not.toHaveBeenCalled();
  });

  it('activates and announces due quizzes, survives a failed broadcast, and clears the caches', async () => {
    world({
      Quiz: (call) => {
        if (isClaim(call)) return { data: [{ id: eqValue(call, 'id') }] };
        const statusIn = call.ops.find((o) => o.op === 'in')?.args;
        if (statusIn && call.ops.some((o) => o.op === 'lte') && !call.ops.some((o) => o.op === 'gt')) return { data: [{ id: 'due1', title: 'Due' }, { id: 'due2', title: 'Due 2' }] };
        return { data: [] };
      },
    });
    createBroadcast.mockRejectedValueOnce(new Error('push down'));

    const res = await runScheduledJobs();

    expect(res.processedQuizzes).toEqual(['due1', 'due2']);
    expect(console.error).toHaveBeenCalledWith('[Jobs] Failed to broadcast notification for quiz due1:', expect.any(Error));
    expect(invalidateQuizCatalog).toHaveBeenCalled();
  });

  it('sends the 10-minute warning once per quiz', async () => {
    world({
      Quiz: (call) => (call.ops.some((o) => o.op === 'gt') && call.ops.some((o) => o.op === 'lte') ? { data: [{ id: 'soon', title: null }, { id: 'warned', title: 'W' }, { id: 'boom', title: 'B' }] } : { data: [] }),
      Notification: (call) => {
        const link = eqValue(call, 'link');
        if (link === '/quizzes?upcoming=warned') return { data: [{ id: 'n' }] };
        if (link === '/quizzes?upcoming=boom') throw new Error('lookup failed');
        return { data: null };
      },
    });

    await runScheduledJobs();

    expect(createBroadcast).toHaveBeenCalledTimes(1);
    expect(createBroadcast).toHaveBeenCalledWith({ title: scheduler.TEN_MINUTE_WARNING_TITLE, message: 'Get ready! "Challenge" starts in 10 minutes. Don\'t miss out!', type: 'quiz_starts_soon', link: '/quizzes?upcoming=soon' });
    expect(eqValue(adminDb.callsTo('Notification')[0], 'title')).toBe(scheduler.TEN_MINUTE_WARNING_TITLE);
    expect(console.error).toHaveBeenCalledWith('[Jobs] Failed to process warning notification for quiz boom:', expect.any(Error));
  });

  it('pauses active quizzes whose answering window is over', async () => {
    world({
      Quiz: (call) => {
        if (isClaim(call)) return { data: [{ id: 'old' }] };
        if (eqValue(call, 'status') === 'active') {
          return { data: [{ id: 'old', pushedAt: minutesAgo(31), duration: 30 }, { id: 'running', pushedAt: minutesAgo(5), duration: 30 }, { id: 'never-pushed', pushedAt: null, duration: 30 }, { id: 'no-duration', pushedAt: minutesAgo(99), duration: 0 }] };
        }
        return { data: [] };
      },
    });

    const res = await runScheduledJobs();

    const pause = adminDb.callsTo('Quiz', 'update')[0];
    expect(argOf(pause, 'update')).toMatchObject({ status: 'paused' });
    expect(pause.ops.find((o) => o.op === 'in')?.args).toEqual(['id', ['old']]);
    expect(eqValue(pause, 'status')).toBe('active');
    expect(res.processedQuizzes).toEqual(['old']);
  });

  it('logs a failed pause and counts nothing', async () => {
    world({
      Quiz: (call) => (isClaim(call) ? { error: { message: 'locked' } } : eqValue(call, 'status') === 'active' ? { data: [{ id: 'old', pushedAt: minutesAgo(60), duration: 1 }] } : { data: [] }),
    });
    expect((await runScheduledJobs()).processedQuizzes).toEqual([]);
    expect(console.error).toHaveBeenCalledWith('[Jobs] Failed to pause expired quizzes:', { message: 'locked' });
  });

  it('a pause that matches no rows still logs and returns nothing', async () => {
    world({ Quiz: (call) => (isClaim(call) ? { data: null } : eqValue(call, 'status') === 'active' ? { data: [{ id: 'old', pushedAt: minutesAgo(60), duration: 1 }] } : { data: [] }) });
    expect((await runScheduledJobs()).processedQuizzes).toEqual([]);
    expect(loggerLog).toHaveBeenCalledWith('[Jobs] Paused 0 expired quizzes.');
  });

  it('dispatches due scheduled notifications exactly once, to one user or everyone', async () => {
    world({
      ScheduledNotification: (call) => {
        if (isClaim(call)) {
          const id = eqValue(call, 'id');
          if (id === 'raced') return { data: [] };
          if (id === 'claim-error') return { error: { message: 'x' } };
          return { data: [{ id }] };
        }
        return {
          data: [
            { id: 'to-user', targetType: 'user', targetUserId: 'u1', title: 't', message: 'm', type: 'info', link: null },
            { id: 'to-all', targetType: 'all', title: 't2', message: 'm2', type: 'info', link: '/x' },
            { id: 'raced', targetType: 'all' },
            { id: 'claim-error', targetType: 'all' },
            { id: 'send-fails', targetType: 'user', targetUserId: 'u2', title: 't', message: 'm', type: 'info' },
          ],
        };
      },
    });
    createNotification.mockImplementation(async (userId: string) => {
      if (userId === 'u2') throw new Error('rls');
      return {};
    });

    const res = await runScheduledJobs();

    expect(res.processedNotifications).toEqual(['to-user', 'to-all']);
    expect(createNotification).toHaveBeenCalledWith('u1', { title: 't', message: 'm', type: 'info', link: undefined });
    expect(createBroadcast).toHaveBeenCalledWith({ title: 't2', message: 'm2', type: 'info', link: '/x' });
    expect(console.error).toHaveBeenCalledWith('[Jobs] Failed to claim scheduled notification claim-error:', { message: 'x' });
    expect(console.error).toHaveBeenCalledWith('[Jobs] Failed to dispatch scheduled notification send-fails:', expect.any(Error));
  });

  it('logs when due notifications cannot be read', async () => {
    world({ ScheduledNotification: { error: { message: 'down' } } });
    await runScheduledJobs();
    expect(console.error).toHaveBeenCalledWith('[Jobs] Failed to fetch due scheduled notifications:', { message: 'down' });
  });

  it('expires deposits pending for more than 48 hours and tells the player', async () => {
    world({
      WalletTransaction: (call) => {
        if (isClaim(call)) {
          const id = eqValue(call, 'id');
          if (id === 'raced') return { data: [] };
          if (id === 'error') return { error: { message: 'x' } };
          return { data: [{ id }] };
        }
        return { data: [{ id: 'stale', userId: 'u1', amount: 500 }, { id: 'raced', userId: 'u2', amount: 1 }, { id: 'error', userId: 'u3', amount: 1 }, { id: 'notify-fails', userId: 'u4', amount: 2 }] };
      },
    });
    createNotification.mockImplementation(async (userId: string) => {
      if (userId === 'u4') throw new Error('push');
      return {};
    });

    const res = await runScheduledJobs();

    expect(res.processedStaleDeposits).toEqual(['stale', 'notify-fails']);
    const reject = adminDb.callsTo('WalletTransaction', 'update')[0];
    expect(argOf(reject, 'update')).toMatchObject({ status: 'rejected', processedBy: 'system', adminNotes: 'Automatically expired after 48 hours.' });
    expect(eqValue(reject, 'status')).toBe('pending');
    expect(createNotification).toHaveBeenCalledWith('u1', expect.objectContaining({ title: 'Deposit Expired', message: expect.stringContaining('500 PKR') }));
    expect(console.error).toHaveBeenCalledWith('[Jobs] Failed to send expiration notification for tx notify-fails:', expect.any(Error));
  });

  it('skips deposit expiry when the pending read fails', async () => {
    world({ WalletTransaction: { error: { message: 'x' } } });
    expect((await runScheduledJobs()).processedStaleDeposits).toEqual([]);
    expect(adminDb.callsTo('WalletTransaction', 'update')).toHaveLength(0);
  });
});

describe('quiz list cache', () => {
  const entry = (timestamp = Date.now()) => ({ data: { quizzes: [], hasAccess: true, paymentInfo: null, accessError: null }, timestamp });

  it('stores entries for five minutes', () => {
    cache.quizListCache.set('a', entry());
    expect(cache.quizListCache.get('a')).toBeDefined();
    cache.quizListCache.set('old', entry(Date.now() - 5 * 60_000 - 1));
    expect(cache.quizListCache.get('old')).toBeUndefined();
    expect(cache.quizListCache.get('missing')).toBeUndefined();
    expect(cache.quizListCache.size).toBe(1);
  });

  it('caps the cache at 500 entries, dropping the oldest', () => {
    for (let i = 0; i < 501; i++) cache.quizListCache.set(`k${i}`, entry());
    expect(cache.quizListCache.size).toBe(500);
    expect(cache.quizListCache.get('k0')).toBeUndefined();
    expect(cache.quizListCache.get('k500')).toBeDefined();
  });

  it('evicts by age and clears together with the catalogue', () => {
    cache.quizListCache.set('fresh', entry());
    cache.quizListCache.set('stale', entry(Date.now() - 10_000));
    cache.quizListCache.evictExpired(5_000);
    expect(cache.quizListCache.size).toBe(1);
    cache.clearQuizListCache();
    expect(cache.quizListCache.size).toBe(0);
    expect(invalidateQuizCatalog).toHaveBeenCalled();
    expect(loggerLog).toHaveBeenCalledWith('[Cache] Clearing quiz list cache');
  });
});

describe('profile validation utils', () => {
  it.each([
    [{ name: 'Ali Khan', email: 'ali@example.test' }, []],
    [{ name: '', email: '' }, ['Name is required', 'Email is required']],
    [{ name: 'A', email: 'nope' }, ['Name must be at least 2 characters long', 'Please enter a valid email address']],
    [{ name: 'x'.repeat(51), email: `${'a'.repeat(95)}@b.com` }, ['Name must be less than 50 characters', 'Email must be less than 100 characters']],
    [{ name: 'R2D2', email: 'a@b.co' }, ['Name can only contain letters, spaces, hyphens, and apostrophes']],
  ])('validateProfileData(%o)', (data, errors) => {
    expect(validation.validateProfileData(data)).toEqual({ isValid: errors.length === 0, errors });
  });

  it('validatePasswordData checks every rule', () => {
    expect(validation.validatePasswordData({ currentPassword: 'Old@1234', newPassword: 'New@1234', confirmPassword: 'New@1234' })).toEqual({ isValid: true, errors: [] });
    expect(validation.validatePasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' }).errors).toEqual(['Current password is required', 'New password is required', 'Password confirmation is required']);
    expect(validation.validatePasswordData({ currentPassword: 'x', newPassword: 'short', confirmPassword: 'other' }).errors).toEqual([
      'New password must be at least 8 characters long',
      'New password must contain at least one uppercase letter',
      'New password must contain at least one number',
      'New password must contain at least one special character (@$!%*?&)',
      'New password and confirmation do not match',
    ]);
    const long = `A1@${'a'.repeat(130)}`;
    expect(validation.validatePasswordData({ currentPassword: 'x', newPassword: long, confirmPassword: long }).errors).toEqual(['New password must be less than 128 characters']);
    expect(validation.validatePasswordData({ currentPassword: 'SAME@1234', newPassword: 'SAME@1234', confirmPassword: 'SAME@1234' }).errors).toEqual([
      'New password must contain at least one lowercase letter',
      'New password must be different from current password',
    ]);
  });

  it('sanitizeInput and formatErrorMessage', () => {
    expect(validation.sanitizeInput('  a   b \n c ')).toBe('a b c');
    expect(validation.formatErrorMessage([])).toBe('');
    expect(validation.formatErrorMessage(['one'])).toBe('one');
    expect(validation.formatErrorMessage(['one', 'two'])).toBe('one. two');
  });
});
