// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createSupabaseMock, makeRequest, eqValue, authOk, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
const auth = vi.fn();
const requireAuth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();
const logger = { logUnauthorizedAccess: vi.fn(), logInvalidInput: vi.fn(), logSecurityEvent: vi.fn() };
const userDb = { findById: vi.fn(), findByEmail: vi.fn(), update: vi.fn(), create: vi.fn() };
const deleteCloudinaryImageByUrl = vi.fn();
let uploadBehaviour: (opts: Record<string, unknown>, cb: (err: unknown, res?: unknown) => void, buf: Buffer) => void;

vi.mock('@/lib/supabase/db', () => ({ getDb: async () => db.client, userDb }));
vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { profile: 'profile', fileUpload: 'fileUpload' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: logger }));
vi.mock('@/lib/cloudinary-server', () => ({ deleteCloudinaryImageByUrl: (...a: unknown[]) => deleteCloudinaryImageByUrl(...a) }));
vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: { upload_stream: (opts: Record<string, unknown>, cb: (err: unknown, res?: unknown) => void) => ({ end: (buf: Buffer) => uploadBehaviour(opts, cb, buf) }) },
  },
}));

const profile = await import('@/app/api/profile/route');
const profileUpdate = await import('@/app/api/profile/update/route');
const picture = await import('@/app/api/profile/upload-picture/route');
const upload = await import('@/app/api/upload/route');

const session = (over: Record<string, unknown> = {}) => ({ user: { id: 'user-1', email: 'player@example.test', name: 'Ali', ...over }, expires: 'x' });
const CLOUD_AVATAR = 'https://res.cloudinary.com/demo/image/upload/v1/avatars/old.jpg';

beforeEach(() => {
  db = createSupabaseMock();
  for (const fn of [auth, requireAuth, requireCSRFToken, applyRateLimit, recordSecurityEvent, deleteCloudinaryImageByUrl, ...Object.values(logger), ...Object.values(userDb)]) fn.mockReset();
  auth.mockResolvedValue(session());
  requireAuth.mockResolvedValue(authOk('admin-user'));
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  deleteCloudinaryImageByUrl.mockResolvedValue(true);
  userDb.update.mockImplementation(async (id: string, data: Record<string, unknown>) => ({ id, name: 'Ali', email: 'player@example.test', createdAt: 'c', ...data }));
  uploadBehaviour = (_o, cb) => cb(null, { secure_url: 'https://res.cloudinary.com/demo/image/upload/v2/avatars/new.avif' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/profile', () => {
  it('assembles the profile, history, best scores and prizes', async () => {
    db.setTable('User', { data: { id: 'user-1', name: 'Ali', email: 'player@example.test', profilePicture: null, points: 40, walletBalance: null, createdAt: 'c' } });
    db.setTable('QuizAttempt', (call) => {
      if (call.ops.some((o) => o.op === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head)) return { count: 7 };
      if (call.ops.find((o) => o.op === 'order')?.args[0] === 'score') return { data: [{ id: 'b1', score: 90, Quiz: [{ id: 'qz', title: 'T' }] }, { id: 'b2', score: 80, Quiz: null }] };
      return { data: [{ id: 'a1', score: 70, Quiz: { id: 'qz', title: 'T' } }, { id: 'a2', score: 10, Quiz: [{ id: 'qz2', title: 'U' }] }, { id: 'orphan', Quiz: null }] };
    });
    db.setTable('Answer', { data: [{ id: 'x', quizAttemptId: 'a1', isCorrect: true }, { id: 'y', quizAttemptId: 'a1', isCorrect: false }] });
    db.setTable('Question', { data: [{ quizId: 'qz' }, { quizId: 'qz' }, { quizId: 'qz2' }] });
    db.setTable('Winning', (call) =>
      call.ops.some((o) => o.op === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head)
        ? { count: 1 }
        : { data: [{ id: 'w1', claimed: false, createdAt: '2026-10-02', Prize: [{ name: 'Watch' }], Quiz: { title: 'T' } }, { id: 'w2', claimed: true, createdAt: '2026-10-03', Prize: { name: 'Pen' }, Quiz: [{ title: 'U' }] }, { id: 'w3', Prize: null, Quiz: {} }] });
    db.setTable('PrizeRedemption', (call) =>
      call.ops.some((o) => o.op === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head)
        ? { count: 2 }
        : { data: [{ id: 'r1', pointsUsed: 5, status: 'pending', requestedAt: '2026-10-05', Prize: [{ name: 'Phone' }] }, { id: 'r2', status: 'approved', requestedAt: '2026-10-01', Prize: { name: 'Bike' } }] });

    const body = await (await profile.GET()).json();

    expect(body.user).toEqual({ id: 'user-1', name: 'Ali', email: 'player@example.test', profilePicture: null, points: 40, walletBalance: 0, createdAt: 'c', totalQuizAttempts: 7, totalWinnings: 3 });
    expect(body.quizHistory.map((h: { id: string }) => h.id)).toEqual(['a1', 'a2']);
    expect(body.quizHistory[0].quiz._count.questions).toBe(2);
    expect(body.quizHistory[0].answers).toHaveLength(2);
    expect(body.quizHistory[1]).toMatchObject({ quiz: { id: 'qz2', _count: { questions: 1 } }, answers: [] });
    expect(body.bestScores).toEqual([{ id: 'b1', score: 90, Quiz: [{ id: 'qz', title: 'T' }], quiz: { id: 'qz', title: 'T' } }]);
    expect(body.recentWinnings.map((p: { id: string; status: string }) => [p.id, p.status])).toEqual([['r1', 'pending'], ['w2', 'claimed'], ['w1', 'unclaimed'], ['r2', 'approved']]);
  });

  it('finds the row by email when the id has no row, and creates one as a last resort', async () => {
    db.setTable('User', [{ data: null, error: { code: 'PGRST116' } }, { data: { id: 'legacy', email: 'player@example.test' } }]);
    expect((await (await profile.GET()).json()).user.id).toBe('legacy');

    db.setTable('User', { data: null, error: { code: 'PGRST116' } });
    userDb.create.mockResolvedValue({ id: 'user-1', email: 'player@example.test', name: 'Ali' });
    expect((await profile.GET()).status).toBe(200);
    expect(userDb.create).toHaveBeenCalledWith({ id: 'user-1', email: 'player@example.test', name: 'Ali', password: null, authProvider: 'google' });

    auth.mockResolvedValue(session({ email: undefined, name: undefined }));
    await profile.GET();
    expect(userDb.create).toHaveBeenLastCalledWith(expect.objectContaining({ email: 'user_user-1@placeholder.local', name: null }));

    userDb.create.mockRejectedValue(new Error('dup'));
    expect((await profile.GET()).status).toBe(404);
  });

  it('returns 404 when the row comes back empty, 500 on other errors, 401 without a session', async () => {
    db.setTable('User', { data: null });
    expect((await profile.GET()).status).toBe(404);
    db.setTable('User', { error: { code: '500' } });
    expect((await profile.GET()).status).toBe(500);
    auth.mockResolvedValue(null);
    expect((await profile.GET()).status).toBe(401);
    auth.mockResolvedValue({ user: null });
    expect((await profile.GET()).status).toBe(401);
  });

  it('skips the batch lookups when there is no history', async () => {
    db.setTable('User', { data: { id: 'user-1' } });
    const body = await (await profile.GET()).json();
    expect(body).toMatchObject({ quizHistory: [], bestScores: [], recentWinnings: [], user: { totalQuizAttempts: 0, totalWinnings: 0 } });
    expect(db.callsTo('Answer')).toHaveLength(0);
  });
});

describe('PUT /api/profile (unused by the app)', () => {
  const put = (body: unknown) => profile.PUT(makeRequest('/api/profile', { method: 'PUT', body }));

  it('updates the name and an unused email', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1' });
    db.setTable('User', { data: null });
    const res = await put({ name: 'New', email: 'new@example.test' });
    expect(res.status).toBe(200);
    expect(userDb.update).toHaveBeenCalledWith('user-1', { name: 'New', email: 'new@example.test' });
    expect(eqValue(db.callsTo('User')[0], 'email')).toBe('new@example.test');
  });

  it('refuses an email that belongs to someone else', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1' });
    db.setTable('User', { data: { id: 'other' } });
    expect((await put({ email: 'taken@example.test' })).status).toBe(400);
  });

  it('changes only the COPIED bcrypt hash in public.User, not the Supabase Auth password', async () => {
    const hash = await bcrypt.hash('OldPass1!', 4);
    userDb.findById.mockResolvedValue({ id: 'user-1', password: hash });
    expect((await put({ currentPassword: 'OldPass1!', newPassword: 'NewPass1!' })).status).toBe(200);
    expect(await bcrypt.compare('NewPass1!', userDb.update.mock.calls[0][1].password)).toBe(true);
  });

  it('guards the password change', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1', password: await bcrypt.hash('OldPass1!', 4) });
    expect((await (await put({ newPassword: 'NewPass1!' })).json()).message).toBe('Current password is required to change password');
    expect((await (await put({ currentPassword: 'wrong', newPassword: 'NewPass1!' })).json()).message).toBe('Current password is incorrect');
    userDb.findById.mockResolvedValue({ id: 'user-1', password: null });
    expect((await (await put({ currentPassword: 'x', newPassword: 'NewPass1!' })).json()).message).toMatch(/no password yet/);
  });

  it('validates, guards and maps failures', async () => {
    expect((await put({ newPassword: '123' })).status).toBe(400);
    userDb.findById.mockResolvedValue(null);
    expect((await put({ name: 'x' })).status).toBe(404);
    userDb.findById.mockResolvedValue({ id: 'user-1' });
    userDb.update.mockRejectedValueOnce({ code: '23505' });
    expect((await put({ name: 'x' })).status).toBe(409);
    userDb.update.mockRejectedValueOnce(new Error('x'));
    expect((await put({ name: 'x' })).status).toBe(500);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await put({ name: 'x' })).status).toBe(429);
    auth.mockResolvedValueOnce(null);
    expect((await put({ name: 'x' })).status).toBe(401);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await put({ name: 'x' })).status).toBe(403);
  });
});

describe('PUT /api/profile/update', () => {
  const put = (body: unknown) => profileUpdate.PUT(makeRequest('/api/profile/update', { method: 'PUT', body }));

  it('updates name and email, normalising both', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1', email: 'player@example.test' });
    const res = await put({ name: ' Ali Khan ', email: 'Player@Example.test' });
    expect(res.status).toBe(200);
    expect(userDb.update).toHaveBeenCalledWith('user-1', { name: 'Ali Khan', email: 'player@example.test' });
    expect(userDb.findByEmail).not.toHaveBeenCalled();
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'PROFILE_UPDATE', userId: 'user-1' }));
  });

  it('changes the stored email WITHOUT verification or touching the Supabase sign-in email', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1', email: 'player@example.test' });
    userDb.findByEmail.mockResolvedValue(null);
    expect((await put({ name: 'Ali', email: 'not-yet-registered@example.test' })).status).toBe(200);
    expect(userDb.update).toHaveBeenCalledWith('user-1', { name: 'Ali', email: 'not-yet-registered@example.test' });
  });

  it('refuses an email used by another player but allows keeping your own', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1', email: 'old@example.test' });
    userDb.findByEmail.mockResolvedValue({ id: 'other' });
    expect((await put({ name: 'Ali', email: 'taken@example.test' })).status).toBe(400);
    userDb.findByEmail.mockResolvedValue({ id: 'user-1' });
    expect((await put({ name: 'Ali', email: 'mine@example.test' })).status).toBe(200);
  });

  it('validates, guards and maps failures', async () => {
    expect((await put({ name: 'A1', email: 'x@y.z' })).status).toBe(400);
    expect(logger.logInvalidInput).toHaveBeenCalled();
    userDb.findById.mockResolvedValue(null);
    expect((await put({ name: 'Ali', email: 'a@b.co' })).status).toBe(404);
    userDb.findById.mockResolvedValue({ id: 'user-1', email: 'a@b.co' });
    for (const [err, status] of [[new Error('duplicate key'), 409], [new Error('connection reset'), 503], [new Error('x'), 500], ['odd', 500]] as const) {
      userDb.update.mockRejectedValueOnce(err);
      expect((await put({ name: 'Ali', email: 'a@b.co' })).status).toBe(status);
    }
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await put({ name: 'Ali', email: 'a@b.co' })).status).toBe(429);
    auth.mockResolvedValueOnce(null);
    expect((await put({ name: 'Ali', email: 'a@b.co' })).status).toBe(401);
    expect(logger.logUnauthorizedAccess).toHaveBeenCalled();
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await put({ name: 'Ali', email: 'a@b.co' })).status).toBe(403);
  });
});

function formRequest(url: string, field: string, file: File | null, method = 'POST', headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.append(field, file);
  return new NextRequest(`http://localhost${url}`, { method, body: form, headers });
}
const image = (type = 'image/png', bytes = 100, name = 'me.png') => new File([new Uint8Array(bytes)], name, { type });

describe('/api/profile/upload-picture', () => {
  const post = (file: File | null = image(), headers: Record<string, string> = {}) => picture.POST(formRequest('/api/profile/upload-picture', 'profilePicture', file, 'POST', headers));

  it('uploads a face-cropped avatar, saves it and deletes the old Cloudinary one', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1', profilePicture: CLOUD_AVATAR });
    let received: { opts: Record<string, unknown>; size: number } | undefined;
    uploadBehaviour = (opts, cb, buf) => {
      received = { opts, size: buf.length };
      cb(null, { secure_url: 'https://new/avatar.avif' });
    };

    const res = await post();

    expect(await res.json()).toEqual({ message: 'Profile picture uploaded successfully', imageUrl: 'https://new/avatar.avif' });
    expect(received).toEqual({ opts: expect.objectContaining({ folder: 'avatars' }), size: 100 });
    expect(userDb.update).toHaveBeenCalledWith('user-1', { profilePicture: 'https://new/avatar.avif' });
    expect(deleteCloudinaryImageByUrl).toHaveBeenCalledWith(CLOUD_AVATAR);
  });

  it('keeps non-Cloudinary avatars and survives a failed delete', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1', profilePicture: 'https://lh3.googleusercontent.com/a.png' });
    expect((await post()).status).toBe(200);
    expect(deleteCloudinaryImageByUrl).not.toHaveBeenCalled();
    userDb.findById.mockResolvedValue({ id: 'user-1', profilePicture: CLOUD_AVATAR });
    deleteCloudinaryImageByUrl.mockRejectedValue(new Error('cdn'));
    expect((await post()).status).toBe(200);
    userDb.findById.mockResolvedValue(null);
    expect((await post()).status).toBe(200);
  });

  it('rejects other file types and files over 5 MB, logging both', async () => {
    let res = await post(image('application/pdf', 10, 'x.pdf'), { 'x-real-ip': '7.7.7.7' });
    expect(res.status).toBe(400);
    expect(recordSecurityEvent).toHaveBeenCalledWith('INVALID_FILE_TYPE', expect.anything(), 'user-1', expect.objectContaining({ fileType: 'application/pdf' }));
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ ip: '7.7.7.7' }));
    res = await post(image('image/jpeg', 5 * 1024 * 1024 + 1), { 'x-forwarded-for': '8.8.8.8' });
    expect((await res.json()).message).toBe('File size too large. Maximum size is 5MB.');
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ ip: '8.8.8.8' }));
    await post(image('image/svg+xml'));
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ ip: 'unknown' }));
    await post(image('image/gif', 5 * 1024 * 1024 + 1));
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ ip: 'unknown' }));
    expect(userDb.update).not.toHaveBeenCalled();
  });

  it('answers 500 when Cloudinary fails or something throws', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1' });
    uploadBehaviour = (_o, cb) => cb(new Error('cloudinary down'));
    expect((await (await post()).json()).message).toBe('Failed to process image through Cloudinary');
    userDb.findById.mockRejectedValue(new Error('db'));
    expect((await (await post()).json()).message).toBe('Internal server error');
  });

  it('guards: CSRF, session, rate limit, missing file', async () => {
    expect((await post(null)).status).toBe(400);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await post(image(), { 'x-forwarded-for': '1.1.1.1' })).status).toBe(429);
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'RATE_LIMIT_EXCEEDED', ip: '1.1.1.1' }));
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    await post(image(), { 'x-real-ip': '2.2.2.2' });
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ ip: '2.2.2.2' }));
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    await post();
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ ip: 'unknown' }));
    auth.mockResolvedValueOnce(null);
    expect((await post()).status).toBe(401);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post()).status).toBe(403);
  });

  it('DELETE removes the avatar from the CDN and the profile', async () => {
    const del = () => picture.DELETE(makeRequest('/api/profile/upload-picture', { method: 'DELETE' }));
    userDb.findById.mockResolvedValue({ id: 'user-1', profilePicture: CLOUD_AVATAR });
    expect(await (await del()).json()).toEqual({ message: 'Profile picture removed successfully' });
    expect(deleteCloudinaryImageByUrl).toHaveBeenCalledWith(CLOUD_AVATAR);
    expect(userDb.update).toHaveBeenCalledWith('user-1', { profilePicture: null });

    deleteCloudinaryImageByUrl.mockRejectedValueOnce(new Error('cdn'));
    expect((await del()).status).toBe(200);
    userDb.findById.mockResolvedValue({ id: 'user-1', profilePicture: null });
    expect((await del()).status).toBe(200);
    userDb.update.mockRejectedValueOnce(new Error('db'));
    expect((await del()).status).toBe(500);
    auth.mockResolvedValueOnce(null);
    expect((await del()).status).toBe(401);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await del()).status).toBe(403);
  });
});

describe('POST /api/upload (admin media)', () => {
  const post = (file: File | null | string = image()) => {
    const form = new FormData();
    if (file !== null) form.append('file', file as Blob);
    return upload.POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
  };

  it('uploads an admin image to the uploads folder', async () => {
    let opts: Record<string, unknown> | undefined;
    uploadBehaviour = (o, cb) => {
      opts = o;
      cb(null, { secure_url: 'https://cdn/x.png' });
    };
    expect(await (await post()).json()).toEqual({ url: 'https://cdn/x.png' });
    expect(requireAuth).toHaveBeenCalledWith({ adminOnly: true, context: 'media_upload' });
    expect(opts).toMatchObject({ folder: 'uploads' });
  });

  it('validates the file', async () => {
    expect((await post(null)).status).toBe(400);
    expect((await post('just text')).status).toBe(400);
    expect((await (await post(image('text/html'))).json()).error).toMatch(/Only JPEG/);
    expect((await (await post(image('image/avif', 10 * 1024 * 1024 + 1))).json()).error).toBe('Image must be 10 MB or smaller');
  });

  it('refuses non-admins and reports upload failures', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post()).status).toBe(403);
    uploadBehaviour = (_o, cb) => cb(new Error('cdn'));
    expect((await post()).status).toBe(500);
  });
});
