// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const requireAdminSession = vi.fn();
const userDb = { findById: vi.fn(), update: vi.fn() };
const notificationDb = { create: vi.fn() };
const sendEmail = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client, userDb, notificationDb }));
vi.mock('@/lib/admin-session', () => ({ requireAdminSession: (...a: unknown[]) => requireAdminSession(...a) }));
vi.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('@/lib/email-templates', () => ({
  buildVerifyEmailEmail: ({ verificationUrl }: { verificationUrl: string }) => ({ subject: 'Verify', html: verificationUrl, text: verificationUrl }),
  buildAdminMessageEmail: ({ title }: { title: string }) => ({ subject: title, html: title, text: title }),
}));

const s = await import('@/actions/support-actions');

const player = { id: 'u1', email: 'ali@example.test', name: 'Ali', password: '$2a$12$hash' };
const securityEvents = () => adminDb.callsTo('SecurityEvent', 'insert').map((c) => argOf(c, 'insert') as Record<string, unknown>);

beforeEach(() => {
  adminDb = createSupabaseMock({ user: { id: 'u1', email: 'ali@example.test' } });
  for (const fn of [requireAdminSession, sendEmail, ...Object.values(userDb), ...Object.values(notificationDb)]) fn.mockReset();
  requireAdminSession.mockResolvedValue('boss@example.test');
  userDb.findById.mockResolvedValue(player);
  sendEmail.mockResolvedValue({ success: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('every support action needs an admin session', () => {
  it.each([
    ['lookupUserAction', () => s.lookupUserAction('u1')],
    ['adjustUserBalanceAction', () => s.adjustUserBalanceAction('u1', 'points', 5, 'r')],
    ['updateUserProfileAction', () => s.updateUserProfileAction('u1', {})],
    ['updateUserPasswordAction', () => s.updateUserPasswordAction('u1', 'x')],
    ['suspendUserAction', () => s.suspendUserAction('u1', true)],
    ['forceVerifyEmailAction', () => s.forceVerifyEmailAction('u1')],
    ['resendVerificationEmailAction', () => s.resendVerificationEmailAction('u1')],
    ['generateImpersonationLinkAction', () => s.generateImpersonationLinkAction('u1')],
    ['sendNotificationAction', () => s.sendNotificationAction('u1', 't', 'm')],
    ['refundQuizAttemptAction', () => s.refundQuizAttemptAction('a1')],
    ['getUserSecurityLogsAction', () => s.getUserSecurityLogsAction('u1')],
    ['addAdminNoteAction', () => s.addAdminNoteAction('u1', 'n', [])],
    ['getAdminNotesAction', () => s.getAdminNotesAction('u1')],
    ['generateGDPRExportAction', () => s.generateGDPRExportAction('u1')],
  ])('%s', async (_name, call) => {
    requireAdminSession.mockRejectedValue(new Error('NEXT_REDIRECT'));
    expect(await call()).toEqual({ success: false, error: 'NEXT_REDIRECT' });
    expect(adminDb.calls).toHaveLength(0);
    expect(adminDb.rpcCalls).toHaveLength(0);
  });

  it('falls back to a generic message for errors without one', async () => {
    requireAdminSession.mockRejectedValue({});
    for (const r of [
      await s.lookupUserAction('x'), await s.adjustUserBalanceAction('u', 'wallet', 1, ''), await s.updateUserProfileAction('u', {}),
      await s.updateUserPasswordAction('u', 'p'), await s.suspendUserAction('u', false), await s.forceVerifyEmailAction('u'),
      await s.resendVerificationEmailAction('u'), await s.generateImpersonationLinkAction('u'), await s.sendNotificationAction('u', 't', 'm'),
      await s.refundQuizAttemptAction('a'), await s.getUserSecurityLogsAction('u'), await s.addAdminNoteAction('u', 'n', []),
      await s.getAdminNotesAction('u'), await s.generateGDPRExportAction('u'),
    ]) {
      expect(r.success).toBe(false);
      expect((r as { error: string }).error).toMatch(/^(An error occurred|Failed to .+)$/);
    }
  });
});

describe('lookupUserAction', () => {
  it('finds a player by email or id, without the password hash, with recent activity', async () => {
    adminDb.setTable('User', { data: player });
    adminDb.setTable('PrizeRedemption', { data: [{ id: 'r' }] });
    adminDb.setTable('QuizAttempt', { data: null });
    const res = await s.lookupUserAction(' ali@example.test ');
    expect(res).toEqual({ success: true, user: { id: 'u1', email: 'ali@example.test', name: 'Ali' }, redemptions: [{ id: 'r' }], attempts: [] });
    expect(eqValue(adminDb.callsTo('User')[0], 'email')).toBe('ali@example.test');
    await s.lookupUserAction('u1');
    expect(eqValue(adminDb.callsTo('User')[1], 'id')).toBe('u1');
    adminDb.setTable('User', { data: null });
    expect(await s.lookupUserAction('ghost')).toEqual({ success: false, error: 'User not found' });
  });
});

describe('balance, profile and password', () => {
  it('adjusts points or wallet through the atomic RPCs and logs it', async () => {
    expect(await s.adjustUserBalanceAction('u1', 'points', 50, 'goodwill')).toEqual({ success: true });
    expect(await s.adjustUserBalanceAction('u1', 'wallet', -10, 'chargeback')).toEqual({ success: true });
    expect(adminDb.rpcCalls).toEqual([
      { fn: 'increment_user_points', args: { p_user_id: 'u1', p_delta: 50 } },
      { fn: 'increment_user_wallet', args: { p_user_id: 'u1', p_delta: -10 } },
    ]);
    expect(securityEvents()[1]).toMatchObject({ type: 'ADMIN_BALANCE_ADJUSTMENT', details: { type: 'wallet', amount: -10, reason: 'chargeback', adminEmail: 'boss@example.test' } });

    adminDb.setRpc('increment_user_points', { error: { message: 'no such user' } });
    adminDb.setRpc('increment_user_wallet', { error: { message: 'negative balance' } });
    expect(await s.adjustUserBalanceAction('u1', 'points', 1, '')).toEqual({ success: false, error: 'no such user' });
    expect(await s.adjustUserBalanceAction('u1', 'wallet', 1, '')).toEqual({ success: false, error: 'negative balance' });

    adminDb.setRpc('increment_user_points', { data: 1 });
    adminDb.client.from.mockImplementationOnce(() => { throw new Error('log failed'); });
    expect(await s.adjustUserBalanceAction('u1', 'points', 1, '')).toEqual({ success: true });
  });

  it('updates profile fields and logs (best effort)', async () => {
    expect(await s.updateUserProfileAction('u1', { name: 'New', phone: '0300' })).toEqual({ success: true });
    expect(userDb.update).toHaveBeenCalledWith('u1', { name: 'New', phone: '0300' });
    adminDb.setTable('SecurityEvent', { error: { message: 'x' } });
    expect(await s.updateUserProfileAction('u1', {})).toEqual({ success: true });
    userDb.update.mockRejectedValueOnce(new Error('rls'));
    expect(await s.updateUserProfileAction('u1', {})).toEqual({ success: false, error: 'rls' });
  });

  it('resets the password in public.User and Supabase Auth', async () => {
    expect(await s.updateUserPasswordAction('u1', 'N3w!pass')).toEqual({ success: true });
    expect(await bcrypt.compare('N3w!pass', userDb.update.mock.calls[0][1].password)).toBe(true);
    expect(adminDb.auth.admin.updateUserById).toHaveBeenCalledWith('u1', { password: 'N3w!pass' });
    expect(securityEvents()[0]).toMatchObject({ type: 'ADMIN_PASSWORD_RESET', severity: 'HIGH' });
  });

  it('finds legacy auth accounts by email, page by page', async () => {
    adminDb.auth.admin.getUserById.mockResolvedValue({ data: { user: null }, error: null } as never);
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `x${i}`, email: `x${i}@x` }));
    adminDb.auth.admin.listUsers
      .mockResolvedValueOnce({ data: { users: full }, error: null } as never)
      .mockResolvedValueOnce({ data: { users: [{ id: 'auth-legacy', email: 'ALI@example.test' }] }, error: null } as never);
    expect(await s.updateUserPasswordAction('u1', 'p')).toEqual({ success: true });
    expect(adminDb.auth.admin.updateUserById).toHaveBeenCalledWith('auth-legacy', { password: 'p' });

    adminDb.auth.admin.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: null } as never);
    adminDb.auth.admin.updateUserById.mockClear();
    adminDb.setTable('SecurityEvent', { error: { message: 'log down' } });
    expect(await s.updateUserPasswordAction('u1', 'p')).toEqual({ success: true });
    expect(adminDb.auth.admin.updateUserById).not.toHaveBeenCalled();

    adminDb.auth.admin.listUsers.mockResolvedValueOnce({ data: null, error: new Error('auth api down') } as never);
    expect(await s.updateUserPasswordAction('u1', 'p')).toEqual({ success: false, error: 'auth api down' });
  });

  it('password reset refuses unknown players and relays auth failures', async () => {
    userDb.findById.mockResolvedValueOnce(null);
    expect(await s.updateUserPasswordAction('u1', 'p')).toEqual({ success: false, error: 'User not found or has no email' });
    adminDb.auth.admin.updateUserById.mockResolvedValueOnce({ data: {}, error: new Error('weak password') } as never);
    expect(await s.updateUserPasswordAction('u1', 'p')).toEqual({ success: false, error: 'weak password' });
  });
});

describe('suspension and email verification', () => {
  it('bans for ten years and lifts the ban', async () => {
    expect(await s.suspendUserAction('u1', true)).toEqual({ success: true });
    expect(adminDb.auth.admin.updateUserById).toHaveBeenLastCalledWith('u1', { ban_duration: '87600h' });
    await s.suspendUserAction('u1', false);
    expect(adminDb.auth.admin.updateUserById).toHaveBeenLastCalledWith('u1', { ban_duration: 'none' });
    expect(securityEvents().map((e) => e.type)).toEqual(['ADMIN_USER_SUSPENDED', 'ADMIN_USER_UNSUSPENDED']);
  });

  it('force-verifies an email', async () => {
    expect(await s.forceVerifyEmailAction('u1')).toEqual({ success: true });
    expect(adminDb.auth.admin.updateUserById).toHaveBeenCalledWith('u1', { email_confirm: true });
  });

  it.each([
    ['suspendUserAction', () => s.suspendUserAction('u1', true)],
    ['forceVerifyEmailAction', () => s.forceVerifyEmailAction('u1')],
  ])('%s handles missing players, missing logins and auth errors', async (_n, call) => {
    userDb.findById.mockResolvedValueOnce({ id: 'u1' });
    expect(await call()).toEqual({ success: false, error: 'User not found' });
    adminDb.auth.admin.getUserById.mockResolvedValueOnce({ data: { user: null }, error: null } as never);
    adminDb.auth.admin.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: null } as never);
    expect(await call()).toEqual({ success: false, error: 'No login account found for this user' });
    adminDb.auth.admin.updateUserById.mockResolvedValueOnce({ data: {}, error: new Error('auth down') } as never);
    expect(await call()).toEqual({ success: false, error: 'auth down' });
  });

  it('resends verification as a magic link through our own mailer', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example.test');
    const fresh = await import('@/actions/support-actions');
    expect(await fresh.resendVerificationEmailAction('u1')).toEqual({ success: true });
    expect(adminDb.auth.admin.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'ali@example.test', options: { redirectTo: 'https://site.example.test' } });
    expect(sendEmail).toHaveBeenCalledWith({ to: 'ali@example.test', subject: 'Verify', html: 'https://example.test/link', text: 'https://example.test/link' });
    vi.unstubAllEnvs();

    sendEmail.mockResolvedValueOnce({ success: false, error: 'smtp down' });
    expect(await s.resendVerificationEmailAction('u1')).toEqual({ success: false, error: 'smtp down' });
    adminDb.auth.admin.generateLink.mockResolvedValueOnce({ data: null, error: new Error('rate limited') } as never);
    expect(await s.resendVerificationEmailAction('u1')).toEqual({ success: false, error: 'rate limited' });
    userDb.findById.mockResolvedValueOnce(null);
    expect(await s.resendVerificationEmailAction('u1')).toEqual({ success: false, error: 'User not found' });
  });
});

describe('impersonation, messages and refunds', () => {
  it('generates a sign-in link as the player and logs it as CRITICAL', async () => {
    expect(await s.generateImpersonationLinkAction('u1')).toEqual({ success: true, link: 'https://example.test/link' });
    expect(securityEvents()[0]).toMatchObject({ type: 'ADMIN_IMPERSONATION_LINK_GENERATED', severity: 'CRITICAL' });
    userDb.findById.mockResolvedValueOnce(null);
    expect((await s.generateImpersonationLinkAction('u1')).success).toBe(false);
    adminDb.auth.admin.generateLink.mockResolvedValueOnce({ data: null, error: new Error('nope') } as never);
    expect(await s.generateImpersonationLinkAction('u1')).toEqual({ success: false, error: 'nope' });
  });

  it('sends an in-app message, optionally by email too', async () => {
    expect(await s.sendNotificationAction('u1', 'Hi', 'There')).toEqual({ success: true, emailSent: false });
    expect(notificationDb.create).toHaveBeenCalledWith('u1', { title: 'Hi', message: 'There', type: 'admin_message', link: '/profile' });
    expect(await s.sendNotificationAction('u1', 'Hi', 'There', true)).toEqual({ success: true, emailSent: true });
    sendEmail.mockResolvedValueOnce({ success: false });
    expect(await s.sendNotificationAction('u1', 'Hi', 'There', true)).toEqual({ success: true, emailSent: false });
    userDb.findById.mockResolvedValueOnce(null);
    expect(await s.sendNotificationAction('u1', 'Hi', 'There', true)).toEqual({ success: true, emailSent: false });
  });

  it('refunds an attempt to the wallet only after deleting it', async () => {
    adminDb.setTable('QuizAttempt', (call) => (call.ops.some((o) => o.op === 'delete') ? { error: null } : { data: { userId: 'u1', quizId: 'q', Quiz: { accessPrice: 2 } } }));
    expect(await s.refundQuizAttemptAction('a1')).toEqual({ success: true });
    expect(adminDb.rpcCalls).toEqual([{ fn: 'increment_user_wallet', args: { p_user_id: 'u1', p_delta: 2 } }]);
    expect(securityEvents()[0]).toMatchObject({ type: 'ADMIN_QUIZ_REFUND', details: { priceRefunded: 2 } });
  });

  it('skips the wallet for free quizzes and never refunds when the delete fails', async () => {
    adminDb.setTable('QuizAttempt', (call) => (call.ops.some((o) => o.op === 'delete') ? { error: null } : { data: { userId: 'u1', Quiz: null } }));
    expect(await s.refundQuizAttemptAction('a1')).toEqual({ success: true });
    expect(adminDb.rpcCalls).toHaveLength(0);

    adminDb.setTable('QuizAttempt', (call) => (call.ops.some((o) => o.op === 'delete') ? { error: new Error('fk') } : { data: { userId: 'u1', Quiz: { accessPrice: 2 } } }));
    expect(await s.refundQuizAttemptAction('a1')).toEqual({ success: false, error: 'fk' });
    expect(adminDb.rpcCalls).toHaveLength(0);

    adminDb.setTable('QuizAttempt', (call) => (call.ops.some((o) => o.op === 'delete') ? { error: null } : { data: { userId: 'u1', Quiz: { accessPrice: 2 } } }));
    adminDb.setRpc('increment_user_wallet', { error: new Error('wallet rpc down') });
    expect(await s.refundQuizAttemptAction('a1')).toEqual({ success: false, error: 'wallet rpc down' });

    adminDb.setTable('QuizAttempt', { data: null, error: { message: 'none' } });
    expect(await s.refundQuizAttemptAction('a1')).toEqual({ success: false, error: 'Attempt not found' });
  });
});

describe('logs, notes and GDPR export', () => {
  it('reads security logs and admin notes, and adds notes', async () => {
    adminDb.setTable('SecurityEvent', { data: [{ id: 'e' }] });
    expect(await s.getUserSecurityLogsAction('u1')).toEqual({ success: true, logs: [{ id: 'e' }] });
    expect(await s.getAdminNotesAction('u1')).toEqual({ success: true, notes: [{ id: 'e' }] });
    expect(eqValue(adminDb.callsTo('SecurityEvent')[1], 'type')).toBe('ADMIN_NOTE');
    expect(await s.addAdminNoteAction('u1', 'Called them', ['vip'])).toEqual({ success: true });
    expect(securityEvents()[0]).toMatchObject({ type: 'ADMIN_NOTE', details: { note: 'Called them', tags: ['vip'], adminEmail: 'boss@example.test' } });

    adminDb.setTable('SecurityEvent', { error: new Error('db') });
    expect(await s.getUserSecurityLogsAction('u1')).toEqual({ success: false, error: 'db' });
    expect(await s.getAdminNotesAction('u1')).toEqual({ success: false, error: 'db' });
  });

  it('exports the profile and activity, INCLUDING the password hash', async () => {
    adminDb.setTable('QuizAttempt', { data: [{ id: 'a' }] });
    adminDb.setTable('PrizeRedemption', { data: null });
    adminDb.setTable('QuizWinner', { data: [{ id: 'w' }] });
    const res = await s.generateGDPRExportAction('u1');
    expect(res.success).toBe(true);
    const data = (res as { data: { profile: Record<string, unknown>; activity: Record<string, unknown> } }).data;
    expect(data.profile.password).toBe('$2a$12$hash');
    expect(data.activity).toEqual({ quizAttempts: [{ id: 'a' }], prizeClaims: [], luckyWins: [{ id: 'w' }] });
    expect(securityEvents()[0]).toMatchObject({ type: 'ADMIN_GDPR_EXPORT_DOWNLOADED' });

    adminDb.setTable('QuizAttempt', { data: null });
    adminDb.setTable('QuizWinner', { data: null });
    expect((await s.generateGDPRExportAction('u1') as { data: { activity: unknown } }).data.activity).toEqual({ quizAttempts: [], prizeClaims: [], luckyWins: [] });
    userDb.findById.mockResolvedValueOnce(null);
    expect(await s.generateGDPRExportAction('u1')).toEqual({ success: false, error: 'User not found' });
  });
});
