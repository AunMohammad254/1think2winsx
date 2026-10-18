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
const storeImage = vi.fn();
const deleteStoredImage = vi.fn();
const removeFolderExcept = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getDb: async () => db.client, getAdminDb: () => db.client, userDb }));
vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { profile: 'profile', fileUpload: 'fileUpload' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: logger }));
vi.mock('@/lib/cloudinary-server', () => ({ deleteCloudinaryImageByUrl: (...a: unknown[]) => deleteCloudinaryImageByUrl(...a) }));
vi.mock('@/lib/media/storage.server', () => ({
  storeImage: (...a: unknown[]) => storeImage(...a),
  deleteStoredImage: (...a: unknown[]) => deleteStoredImage(...a),
  removeFolderExcept: (...a: unknown[]) => removeFolderExcept(...a),
}));

const profile = await import('@/app/api/profile/route');
const profileUpdate = await import('@/app/api/profile/update/route');
const picture = await import('@/app/api/profile/upload-picture/route');
const upload = await import('@/app/api/upload/route');
const { InvalidImageError } = await import('@/lib/media/image-processing');

const session = (over: Record<string, unknown> = {}) => ({ user: { id: 'user-1', email: 'player@example.test', name: 'Ali', ...over }, expires: 'x' });
const CLOUD_AVATAR = 'https://res.cloudinary.com/dszrz6s6u/image/upload/v1/avatars/old.jpg';

beforeEach(() => {
  db = createSupabaseMock();
  for (const fn of [auth, requireAuth, requireCSRFToken, applyRateLimit, recordSecurityEvent, deleteCloudinaryImageByUrl, storeImage, deleteStoredImage, removeFolderExcept, ...Object.values(logger), ...Object.values(userDb)]) fn.mockReset();
  auth.mockResolvedValue(session());
  requireAuth.mockResolvedValue(authOk('admin-user'));
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  deleteCloudinaryImageByUrl.mockResolvedValue(true);
  userDb.update.mockImplementation(async (id: string, data: Record<string, unknown>) => ({ id, name: 'Ali', email: 'player@example.test', createdAt: 'c', ...data }));
  storeImage.mockResolvedValue(stored);
  deleteStoredImage.mockResolvedValue(true);
  removeFolderExcept.mockResolvedValue([]);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
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

  it('copes with missing answers and question counts, and object Quiz joins', async () => {
    db.setTable('User', { data: { id: 'user-1', name: 'Ali', email: 'player@example.test', points: 0, createdAt: 'c' } });
    db.setTable('QuizAttempt', (call) => {
      if (call.ops.some((o) => o.op === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head)) return { count: 1 };
      if (call.ops.find((o) => o.op === 'order')?.args[0] === 'score') return { data: [{ id: 'b1', score: 60, Quiz: { id: 'qz', title: 'T' } }] };
      return { data: [{ id: 'a1', score: 60, Quiz: { id: 'qz', title: 'T' } }] };
    });
    db.setTable('Answer', { data: null });
    db.setTable('Question', { data: null });
    const body = await (await profile.GET()).json();
    expect(body.quizHistory[0]).toMatchObject({ quiz: { id: 'qz', _count: { questions: 0 } }, answers: [] });
    expect(body.bestScores[0].quiz).toEqual({ id: 'qz', title: 'T' });
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
const NEW_AVATAR = 'https://proj.supabase.co/storage/v1/object/public/avatars/user-1/new-256.webp';
const stored = { url: NEW_AVATAR, paths: ['user-1/new-256.webp'], bytes: 900 };

describe('/api/profile/upload-picture', () => {
  const post = (file: File | null = image(), headers: Record<string, string> = {}) => picture.POST(formRequest('/api/profile/upload-picture', 'profilePicture', file, 'POST', headers));

  it('stores a 256px avatar with the player session, saves it, then deletes the previous pictures', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1', profilePicture: CLOUD_AVATAR });

    const res = await post();

    expect(await res.json()).toEqual({ message: 'Profile picture uploaded successfully', imageUrl: NEW_AVATAR });
    // The player's own client (getDb), so storage policies confine it to avatars/user-1/
    expect(storeImage).toHaveBeenCalledWith(db.client, 'avatars', 'user-1', expect.any(Buffer));
    expect((storeImage.mock.calls[0][3] as Buffer).length).toBe(100);
    expect(userDb.update).toHaveBeenCalledWith('user-1', { profilePicture: NEW_AVATAR });
    expect(removeFolderExcept).toHaveBeenCalledWith(db.client, 'avatars', 'user-1', ['user-1/new-256.webp']);
    expect(deleteCloudinaryImageByUrl).toHaveBeenCalledWith(CLOUD_AVATAR);
    // Saved before anything old is deleted
    expect(userDb.update.mock.invocationCallOrder[0]).toBeLessThan(removeFolderExcept.mock.invocationCallOrder[0]);
  });

  it('leaves external pictures alone and survives a failed delete of the old files', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1', profilePicture: 'https://lh3.googleusercontent.com/a.png' });
    removeFolderExcept.mockRejectedValueOnce(new Error('storage down'));
    expect((await post()).status).toBe(200);
    expect(console.error).toHaveBeenCalledWith('Failed to delete old profile pictures:', expect.any(Error));
    expect(deleteCloudinaryImageByUrl).not.toHaveBeenCalled();
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

  it('answers 400 for a file that is not really an image, 500 when storage fails', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1' });
    storeImage.mockRejectedValueOnce(new InvalidImageError());
    let res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('The file could not be read as an image.');
    storeImage.mockRejectedValueOnce(new Error('bucket missing'));
    res = await post();
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe('Failed to store the image');
    expect(userDb.update).not.toHaveBeenCalled();
  });

  it('removes the new file again when the profile cannot be saved', async () => {
    userDb.findById.mockResolvedValue({ id: 'user-1', profilePicture: CLOUD_AVATAR });
    userDb.update.mockRejectedValueOnce(new Error('db'));
    let res = await post();
    expect(res.status).toBe(500);
    expect(deleteStoredImage).toHaveBeenCalledWith(db.client, NEW_AVATAR);
    expect(removeFolderExcept).not.toHaveBeenCalled();
    expect(deleteCloudinaryImageByUrl).not.toHaveBeenCalled();
    // ...even if that clean-up fails too
    userDb.update.mockRejectedValueOnce(new Error('db'));
    deleteStoredImage.mockRejectedValueOnce(new Error('storage'));
    res = await post();
    expect((await res.json()).message).toBe('Internal server error');
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
    expect(storeImage).not.toHaveBeenCalled();
  });

  it('DELETE clears the profile, then deletes every stored picture and an old Cloudinary one', async () => {
    const del = () => picture.DELETE(makeRequest('/api/profile/upload-picture', { method: 'DELETE' }));
    userDb.findById.mockResolvedValue({ id: 'user-1', profilePicture: CLOUD_AVATAR });
    expect(await (await del()).json()).toEqual({ message: 'Profile picture removed successfully' });
    expect(userDb.update).toHaveBeenCalledWith('user-1', { profilePicture: null });
    expect(removeFolderExcept).toHaveBeenCalledWith(db.client, 'avatars', 'user-1', []);
    expect(deleteCloudinaryImageByUrl).toHaveBeenCalledWith(CLOUD_AVATAR);
    expect(userDb.update.mock.invocationCallOrder[0]).toBeLessThan(removeFolderExcept.mock.invocationCallOrder[0]);

    userDb.findById.mockResolvedValue({ id: 'user-1', profilePicture: NEW_AVATAR });
    deleteCloudinaryImageByUrl.mockClear();
    expect((await del()).status).toBe(200);
    expect(deleteCloudinaryImageByUrl).not.toHaveBeenCalled();
    userDb.update.mockRejectedValueOnce(new Error('db'));
    expect((await del()).status).toBe(500);
    auth.mockResolvedValueOnce(null);
    expect((await del()).status).toBe(401);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await del()).status).toBe(403);
  });
});

describe('POST /api/upload (admin media)', () => {
  const post = (file: File | null | string = image(), target?: string) => {
    const form = new FormData();
    if (file !== null) form.append('file', file as Blob);
    if (target) form.append('target', target);
    return upload.POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
  };
  const PRIZE_URL = 'https://proj.supabase.co/storage/v1/object/public/prize-images/prizes/a-1280.webp';

  it('stores prize images by default and site images with target=site, using the service role', async () => {
    storeImage.mockResolvedValue({ url: PRIZE_URL, paths: [], bytes: 1 });
    expect(await (await post()).json()).toEqual({ url: PRIZE_URL });
    expect(requireAuth).toHaveBeenCalledWith({ adminOnly: true, context: 'media_upload' });
    expect(storeImage).toHaveBeenLastCalledWith(db.client, 'prize-images', 'prizes', expect.any(Buffer));
    await post(image(), 'prize');
    expect(storeImage).toHaveBeenLastCalledWith(db.client, 'prize-images', 'prizes', expect.any(Buffer));
    await post(image(), 'site');
    expect(storeImage).toHaveBeenLastCalledWith(db.client, 'site-media', 'uploads', expect.any(Buffer));
  });

  it('validates the file', async () => {
    expect((await post(null)).status).toBe(400);
    expect((await post('just text')).status).toBe(400);
    expect((await (await post(image('text/html'))).json()).error).toMatch(/Only JPEG/);
    expect((await (await post(image('image/avif', 10 * 1024 * 1024 + 1))).json()).error).toBe('Image must be 10 MB or smaller');
    storeImage.mockRejectedValueOnce(new InvalidImageError());
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('The file could not be read as an image');
  });

  it('refuses non-admins and reports storage failures', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post()).status).toBe(403);
    storeImage.mockRejectedValueOnce(new Error('storage'));
    expect((await post()).status).toBe(500);
  });
});
