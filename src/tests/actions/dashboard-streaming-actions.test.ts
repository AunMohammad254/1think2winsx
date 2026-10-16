// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const adminActionGuard = vi.fn();
const assertAdmin = vi.fn();
const revalidatePath = vi.fn();
const quizDb = { update: vi.fn() };
const questionDb = { findByQuizId: vi.fn() };
const createBroadcast = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client, quizDb, questionDb, notificationDb: { createBroadcast: (...a: unknown[]) => createBroadcast(...a) } }));
vi.mock('@/lib/admin-guard', () => ({ adminActionGuard: (...a: unknown[]) => adminActionGuard(...a), assertAdmin: (...a: unknown[]) => assertAdmin(...a) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const dash = await import('@/actions/dashboard-actions');
const stream = await import('@/actions/streaming-actions');

const DENIED = { success: false, error: 'Unauthorized: admin session required' };
const isHead = (call: { ops: { op: string; args: unknown[] }[] }) => call.ops.some((o) => o.op === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head);

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [adminActionGuard, assertAdmin, revalidatePath, createBroadcast, quizDb.update, questionDb.findByQuizId]) fn.mockReset();
  adminActionGuard.mockResolvedValue(null);
  assertAdmin.mockResolvedValue('boss@example.test');
  createBroadcast.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('dashboard read actions require an admin', () => {
  it.each([
    ['getDashboardStats', () => dash.getDashboardStats()],
    ['getRecentActivity', () => dash.getRecentActivity()],
    ['getQuizzes', () => dash.getQuizzes({})],
    ['getQuizById', () => dash.getQuizById('q')],
  ])('%s throws for non-admins', async (_n, call) => {
    assertAdmin.mockRejectedValue(new Error('Admin authentication required'));
    await expect(call()).rejects.toThrow('Admin authentication required');
    expect(adminDb.calls).toHaveLength(0);
  });
});

describe('getDashboardStats', () => {
  it('counts users, quizzes and attempts, and averages scores and revenue', async () => {
    adminDb.setTable('*', (call) => {
      if (isHead(call)) {
        if (call.table === 'User') return { count: call.ops.some((o) => o.op === 'gte') ? 3 : 40 };
        if (call.table === 'Quiz') return { count: ({ active: 2, draft: 1, paused: 1 } as Record<string, number>)[eqValue(call, 'status') as string] ?? 4 };
        return { count: call.ops.some((o) => o.op === 'gte') ? 5 : eqValue(call, 'isCompleted') ? 9 : 12 };
      }
      return call.table === 'QuizAttempt' ? { data: [{ score: 80 }, { score: 61 }, { score: null }] } : { data: [{ amount: 2 }, { amount: null }, { amount: 3 }] };
    });
    expect(await dash.getDashboardStats()).toEqual({
      totalUsers: 40, recentUsers: 3, totalQuizzes: 4, activeQuizzes: 2, draftQuizzes: 1, pausedQuizzes: 1,
      totalAttempts: 12, completedAttempts: 9, recentAttempts: 5, averageScore: 47, totalRevenue: 5, completionRate: 75,
    });
  });

  it('is all zeros on an empty database', async () => {
    adminDb.setTable('*', { data: null, count: null });
    expect(await dash.getDashboardStats()).toMatchObject({ totalUsers: 0, averageScore: 0, totalRevenue: 0, completionRate: 0 });
  });
});

describe('getRecentActivity', () => {
  it('merges recent attempts and sign-ups, newest first, up to the limit', async () => {
    adminDb.setTable('QuizAttempt', { data: [{ id: 'a1', userId: 'u1', quizId: 'q1', score: 90, createdAt: '2026-10-05T00:00:00Z' }, { id: 'a2', userId: 'gone', quizId: 'q2', score: 10, createdAt: '2026-10-04T00:00:00Z' }] });
    adminDb.setTable('User', (call) => {
      if (call.ops.some((o) => o.op === 'gte')) return { data: [{ id: 'u9', email: 'new@x', name: null, createdAt: '2026-10-06T00:00:00Z' }] };
      return { data: eqValue(call, 'id') === 'u1' ? { id: 'u1', email: 'a@x', name: 'Ali' } : null };
    });
    adminDb.setTable('Quiz', (call) => ({ data: eqValue(call, 'id') === 'q1' ? { id: 'q1', title: 'Cricket' } : null }));

    const activity = await dash.getRecentActivity(4);

    expect(activity.map((a) => [a.type, a.id])).toEqual([['user_signup', 'u9'], ['quiz_attempt', 'a1']]);
    expect(activity[1]).toMatchObject({ userEmail: 'a@x', quizTitle: 'Cricket', score: 90 });
    expect(argOf(adminDb.callsTo('QuizAttempt')[0], 'limit')).toBe(2);
  });

  it('handles attempts whose quiz is gone and an empty feed', async () => {
    adminDb.setTable('QuizAttempt', { data: [{ id: 'a1', userId: 'u1', quizId: 'q-gone', createdAt: '2026-10-05T00:00:00Z' }] });
    adminDb.setTable('User', (call) => (call.ops.some((o) => o.op === 'gte') ? { data: null } : { data: { id: 'u1', email: 'a@x', name: 'A' } }));
    expect((await dash.getRecentActivity())[0]).toMatchObject({ quizId: null, quizTitle: null });
    adminDb.setTable('QuizAttempt', { data: null });
    expect(await dash.getRecentActivity()).toEqual([]);
  });
});

describe('getQuizzes and getQuizById', () => {
  it('searches, filters, sorts and pages, with per-quiz counts', async () => {
    adminDb.setTable('Quiz', { data: [{ id: 'q1', title: 'A', createdAt: '2026-01-01', updatedAt: '2026-01-02' }], count: 21 });
    adminDb.setTable('Question', { count: 3 });
    adminDb.setTable('QuizAttempt', { count: null });
    const res = await dash.getQuizzes({ page: 3, pageSize: 10, search: 'cup', status: 'active', sortBy: 'title', sortOrder: 'asc' });
    expect(res.pagination).toEqual({ total: 21, page: 3, pageSize: 10, totalPages: 3 });
    expect(res.quizzes[0]._count).toEqual({ questions: 3, attempts: 0 });
    const q = adminDb.callsTo('Quiz')[0];
    expect(argOf(q, 'or')).toBe('title.ilike.%cup%,description.ilike.%cup%');
    expect(eqValue(q, 'status')).toBe('active');
    expect(q.ops.find((o) => o.op === 'order')?.args).toEqual(['title', { ascending: true }]);
    expect(q.ops.find((o) => o.op === 'range')?.args).toEqual([20, 29]);
  });

  it('falls back to createdAt ordering, defaults, and an empty page on error', async () => {
    adminDb.setTable('Quiz', { data: null, count: null });
    const res = await dash.getQuizzes({ sortBy: 'password' });
    expect(adminDb.callsTo('Quiz')[0].ops.find((o) => o.op === 'order')?.args).toEqual(['createdAt', { ascending: false }]);
    expect(res).toEqual({ quizzes: [], pagination: { total: 0, page: 1, pageSize: 10, totalPages: 0 } });
    adminDb.setTable('Quiz', { error: { message: 'x' } });
    expect((await dash.getQuizzes({ page: 2 })).pagination).toEqual({ total: 0, page: 2, pageSize: 10, totalPages: 0 });
  });

  it('getQuizById returns the quiz with questions and counts, or null', async () => {
    adminDb.setTable('Quiz', { data: { id: 'q1', title: 'A' } });
    adminDb.setTable('Question', (call) => (isHead(call) ? { count: 2 } : { data: [{ id: 'x' }] }));
    adminDb.setTable('QuizAttempt', { count: 5 });
    expect(await dash.getQuizById('q1')).toEqual({ id: 'q1', title: 'A', questions: [{ id: 'x' }], _count: { questions: 2, attempts: 5 } });
    adminDb.setTable('Question', { data: null, count: null });
    adminDb.setTable('QuizAttempt', { count: null });
    expect(await dash.getQuizById('q1')).toMatchObject({ questions: [], _count: { questions: 0, attempts: 0 } });
    adminDb.setTable('Quiz', { data: null, error: { code: 'PGRST116' } });
    expect(await dash.getQuizById('q1')).toBeNull();
  });
});

describe('toggleQuizStatus', () => {
  it('publishes only quizzes with questions', async () => {
    questionDb.findByQuizId.mockResolvedValue([]);
    expect(await dash.toggleQuizStatus('q', 'active')).toEqual({ success: false, error: 'Cannot publish quiz without questions' });
    questionDb.findByQuizId.mockResolvedValue([{ id: 'x' }]);
    quizDb.update.mockResolvedValue({ status: 'active' });
    expect(await dash.toggleQuizStatus('q', 'active')).toEqual({ success: true, data: { status: 'active' }, message: 'Quiz published successfully!' });
  });

  it('pauses or drafts, and reports missing quizzes and errors', async () => {
    quizDb.update.mockResolvedValue({ status: 'paused' });
    expect(((await dash.toggleQuizStatus('q', 'paused')) as { message?: string }).message).toBe('Quiz paused successfully!');
    quizDb.update.mockResolvedValue({ status: 'draft' });
    expect(((await dash.toggleQuizStatus('q', 'draft')) as { message?: string }).message).toBe('Quiz set to draft successfully!');
    expect(questionDb.findByQuizId).not.toHaveBeenCalled();
    quizDb.update.mockResolvedValue(null);
    expect(await dash.toggleQuizStatus('q', 'draft')).toEqual({ success: false, error: 'Quiz not found' });
    quizDb.update.mockRejectedValue(new Error('x'));
    expect(await dash.toggleQuizStatus('q', 'draft')).toEqual({ success: false, error: 'Failed to update quiz status' });
    adminActionGuard.mockResolvedValue(DENIED);
    expect(await dash.toggleQuizStatus('q', 'draft')).toEqual(DENIED);
  });
});

describe('streaming actions', () => {
  it('getStreamConfig is public and returns the admin email that last changed the stream', async () => {
    adminDb.setRpc('get_live_stream_config', { data: { success: true, isActive: true, embedHtml: '<iframe/>', embedUrl: null, title: 'T', platform: 'youtube', updatedAt: 'w', updatedBy: 'boss@example.test' } });
    expect(await stream.getStreamConfig()).toMatchObject({ success: true, isActive: true, updatedBy: 'boss@example.test' });
    expect(adminActionGuard).not.toHaveBeenCalled();
  });

  it('getStreamConfig defaults and errors', async () => {
    adminDb.setRpc('get_live_stream_config', { data: { success: true } });
    expect(await stream.getStreamConfig()).toMatchObject({ isActive: false, embedHtml: '', embedUrl: null, title: 'Livestream', platform: 'custom' });
    adminDb.setRpc('get_live_stream_config', { data: { success: false, message: 'Nothing yet' } });
    expect(await stream.getStreamConfig()).toMatchObject({ success: true, isActive: false, message: 'Nothing yet' });
    adminDb.setRpc('get_live_stream_config', { data: null });
    expect((await stream.getStreamConfig()).message).toBe('No stream configured');
    adminDb.setRpc('get_live_stream_config', { error: { message: 'rpc' } });
    expect(await stream.getStreamConfig()).toMatchObject({ success: false, error: 'rpc' });
    adminDb.client.rpc.mockImplementationOnce(() => { throw new Error('boom'); });
    expect((await stream.getStreamConfig()).error).toBe('boom');
    adminDb.client.rpc.mockImplementationOnce(() => { throw 'odd'; });
    expect((await stream.getStreamConfig()).error).toBe('Unknown error');
  });

  it('updateStreamConfig strips <script> tags but KEEPS event handlers', async () => {
    adminDb.setRpc('update_live_stream_config', (args) => ({ data: { success: true, isActive: true, title: 'Final', embedHtml: args.p_embed_html } }));
    const res = await stream.updateStreamConfig({ embedHtml: '  <iframe src="https://x" onload="steal()"></iframe><script>alert(1)</script><img src=x onerror=alert(2)>  ', title: 'Final', platform: 'youtube' }, 'boss@example.test');
    const saved = adminDb.rpcCalls[0].args.p_embed_html as string;
    expect(saved).not.toContain('<script');
    expect(saved).toContain('onload="steal()"');
    expect(saved).toContain('onerror=alert(2)');
    expect(res).toMatchObject({ success: true, data: { title: 'Final', isActive: true } });
    expect(adminDb.rpcCalls[0].args).toMatchObject({ p_embed_url: null, p_title: 'Final', p_platform: 'youtube', p_is_active: true, p_admin_email: 'boss@example.test' });
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({ title: '🔴 Live Stream is Active!', message: expect.stringContaining('"Final"') }));
  });

  it('updateStreamConfig validates the embed and the URL', async () => {
    const bad = async (input: Record<string, unknown>) => ((await stream.updateStreamConfig(input)) as { error: string }).error;
    expect(await bad({})).toBe('Either embedHtml or embedUrl is required');
    expect(await bad({ embedHtml: '<p>x</p>' })).toBe('Embed HTML must be at least 10 characters');
    expect(await bad({ embedHtml: '<div>no player here</div>' })).toBe('Embed code must contain an iframe, video, embed, or object element');
    expect(await bad({ embedUrl: 'javascript:alert(1)' })).toBe('Embed URL must be a valid HTTP/HTTPS URL');
    expect(await bad({ embedUrl: 'not a url' })).toBe('Invalid embed URL format');
    expect(adminDb.rpcCalls).toHaveLength(0);
  });

  it('updateStreamConfig with a URL only, inactive streams, and failures', async () => {
    adminDb.setRpc('update_live_stream_config', { data: { success: true, isActive: false } });
    expect((await stream.updateStreamConfig({ embedUrl: 'https://youtube.com/live', isActive: false })).success).toBe(true);
    expect(adminDb.rpcCalls[0].args).toMatchObject({ p_embed_html: null, p_title: 'Livestream', p_platform: 'custom', p_is_active: false, p_admin_email: 'admin' });
    expect(createBroadcast).not.toHaveBeenCalled();

    adminDb.setRpc('update_live_stream_config', { data: { success: true, isActive: true, title: null } });
    createBroadcast.mockRejectedValueOnce(new Error('push'));
    expect((await stream.updateStreamConfig({ embedUrl: 'https://x.test' })).success).toBe(true);
    expect(createBroadcast.mock.calls[0][0].message).toContain('"Live Session"');

    adminDb.setRpc('update_live_stream_config', { error: { message: 'rpc' } });
    expect(await stream.updateStreamConfig({ embedUrl: 'https://x.test' })).toEqual({ success: false, error: 'rpc' });
    adminDb.setRpc('update_live_stream_config', { data: { success: false } });
    expect((await stream.updateStreamConfig({ embedUrl: 'https://x.test' }) as { error: string }).error).toBe('Failed to update stream configuration');
    adminDb.setRpc('update_live_stream_config', { data: { success: false, error: 'locked' } });
    expect((await stream.updateStreamConfig({ embedUrl: 'https://x.test' }) as { error: string }).error).toBe('locked');
    adminDb.client.rpc.mockImplementationOnce(() => { throw new Error('boom'); });
    expect((await stream.updateStreamConfig({ embedUrl: 'https://x.test' }) as { error: string }).error).toBe('boom');
    adminDb.client.rpc.mockImplementationOnce(() => { throw 'odd'; });
    expect((await stream.updateStreamConfig({ embedUrl: 'https://x.test' }) as { error: string }).error).toBe('Unknown error');
  });

  it('toggleStreamStatus announces going live and reports failures', async () => {
    adminDb.setRpc('toggle_stream_status', { data: { success: true, isActive: true } });
    expect(await stream.toggleStreamStatus(true)).toEqual({ success: true, data: { isActive: true } });
    expect(adminDb.rpcCalls[0].args).toEqual({ p_is_active: true, p_admin_email: 'admin' });
    expect(createBroadcast).toHaveBeenCalledTimes(1);
    createBroadcast.mockRejectedValueOnce(new Error('push'));
    expect((await stream.toggleStreamStatus(true, 'b@x')).success).toBe(true);
    adminDb.setRpc('toggle_stream_status', { data: { success: true, isActive: false } });
    createBroadcast.mockClear();
    await stream.toggleStreamStatus(false);
    expect(createBroadcast).not.toHaveBeenCalled();

    adminDb.setRpc('toggle_stream_status', { error: { message: 'rpc' } });
    expect(await stream.toggleStreamStatus(true)).toEqual({ success: false, error: 'rpc' });
    adminDb.setRpc('toggle_stream_status', { data: { success: false } });
    expect((await stream.toggleStreamStatus(true) as { error: string }).error).toBe('Failed to toggle stream status');
    adminDb.setRpc('toggle_stream_status', { data: { success: false, error: 'nope' } });
    expect((await stream.toggleStreamStatus(true) as { error: string }).error).toBe('nope');
    adminDb.client.rpc.mockImplementationOnce(() => { throw new Error('boom'); });
    expect((await stream.toggleStreamStatus(true) as { error: string }).error).toBe('boom');
    adminDb.client.rpc.mockImplementationOnce(() => { throw 'odd'; });
    expect((await stream.toggleStreamStatus(true) as { error: string }).error).toBe('Unknown error');
  });

  it('update and toggle need an admin', async () => {
    adminActionGuard.mockResolvedValue(DENIED);
    expect(await stream.updateStreamConfig({ embedUrl: 'https://x' })).toEqual(DENIED);
    expect(await stream.toggleStreamStatus(true)).toEqual(DENIED);
    expect(adminDb.rpcCalls).toHaveLength(0);
  });
});
