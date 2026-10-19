// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
let sb: SupabaseMock;
const requireAdminSession = vi.fn();
const cloudinaryApi = { usage: vi.fn(), resources: vi.fn(), delete_resources: vi.fn() };
const destroy = vi.fn();
const upload = vi.fn();
const cloudinaryUrl = vi.fn();
const sendPasswordSetupEmail = vi.fn();
const checkLimit = vi.fn();
const storeImage = vi.fn();
const listMediaImages = vi.fn();
const fetchRemoteImage = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => sb.client }));
vi.mock('@/lib/admin-session', () => ({ requireAdminSession: (...a: unknown[]) => requireAdminSession(...a) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    url: (...a: unknown[]) => cloudinaryUrl(...a),
    api: cloudinaryApi,
    uploader: {
      destroy: (...a: unknown[]) => destroy(...a),
      upload: (...a: unknown[]) => upload(...a),
    },
  },
}));
vi.mock('@/lib/media/storage.server', () => ({
  storeImage: (...a: unknown[]) => storeImage(...a),
}));
vi.mock('@/lib/media/remote-image.server', () => ({
  fetchRemoteImage: (...a: unknown[]) => fetchRemoteImage(...a),
}));
vi.mock('@/actions/supabase-media-actions', () => ({
  listMediaImages: (...a: unknown[]) => listMediaImages(...a),
}));
vi.mock('@/lib/password-setup', () => ({ sendPasswordSetupEmail: (...a: unknown[]) => sendPasswordSetupEmail(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { passwordChange: { checkLimit: (...a: unknown[]) => checkLimit(...a) } } }));

const analytics = await import('@/actions/analytics-actions');
const media = await import('@/actions/media-actions');
const pwSetup = await import('@/actions/password-setup-actions');

beforeEach(() => {
  adminDb = createSupabaseMock();
  sb = createSupabaseMock({ user: { id: 'u1', email: 'ali@example.test' } });
  for (const fn of [requireAdminSession, cloudinaryApi.usage, cloudinaryApi.resources, cloudinaryApi.delete_resources, destroy, upload, cloudinaryUrl, storeImage, listMediaImages, fetchRemoteImage, sendPasswordSetupEmail, checkLimit]) fn.mockReset();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
  requireAdminSession.mockResolvedValue('boss@example.test');
  checkLimit.mockResolvedValue({ success: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('getAnalyticsData', () => {
  it('adds live-quiz engagement, the score distribution and notification efficacy to the RPC data', async () => {
    adminDb.setRpc('get_admin_analytics', { data: { revenue: [{ date: 'd', amount: 4 }] } });
    adminDb.setTable('Quiz', { data: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] });
    adminDb.setTable('QuizAttempt', (call) => (call.ops.some((o) => o.op === 'in') ? { count: 10 } : { data: [{ score: 0 }, { score: 20 }, { score: 35 }, { score: 60 }, { score: 61 }, { score: 99 }, { score: null }] }));
    // Counted in the database: all notifications, and the ones players opened
    adminDb.setTable('Notification', (call) => (call.ops.some((o) => o.op === 'eq') ? { count: 2 } : { count: 3 }));

    const data = await analytics.getAnalyticsData();

    expect(data.revenue).toEqual([{ date: 'd', amount: 4 }]);
    expect(data.liveQuizEngagement).toEqual({ totalLiveQuizzes: 3, totalLiveAttempts: 10, avgAttemptsPerLiveQuiz: 3 });
    expect(data.scoreDistribution).toEqual([
      { range: '0-20', count: 3 }, { range: '21-40', count: 1 }, { range: '41-60', count: 1 }, { range: '61-80', count: 1 }, { range: '81-100', count: 1 },
    ]);
    expect(data.notificationEfficacy).toEqual({ totalSent: 3, totalRead: 2, ctr: 67 });
  });

  it('measures every notification players receive (it used to count only "quiz_results", which nothing sends)', async () => {
    adminDb.setRpc('get_admin_analytics', { data: {} });
    await analytics.getAnalyticsData();
    const [all, opened] = adminDb.callsTo('Notification');
    expect(eqValue(all, 'type')).toBeUndefined();
    expect(eqValue(opened, 'type')).toBeUndefined();
    expect(eqValue(opened, 'read')).toBe(true);
  });

  it('handles no live quizzes, no scores and no notifications', async () => {
    adminDb.setRpc('get_admin_analytics', { data: {} });
    adminDb.setTable('*', { data: null, count: null });
    const data = await analytics.getAnalyticsData();
    expect(data.liveQuizEngagement).toEqual({ totalLiveQuizzes: 0, totalLiveAttempts: 0, avgAttemptsPerLiveQuiz: 0 });
    expect(data.scoreDistribution.every((d) => d.count === 0)).toBe(true);
    expect(data.notificationEfficacy).toEqual({ totalSent: 0, totalRead: 0, ctr: 0 });
    adminDb.setTable('Quiz', { data: [{ id: 'q' }] });
    adminDb.setTable('QuizAttempt', (call) => (call.ops.some((o) => o.op === 'in') ? { count: null } : { data: [] }));
    expect((await analytics.getAnalyticsData()).liveQuizEngagement.totalLiveAttempts).toBe(0);
  });

  it('throws when the RPC fails and needs an admin', async () => {
    adminDb.setRpc('get_admin_analytics', { error: { message: 'rpc down' } });
    await expect(analytics.getAnalyticsData()).rejects.toThrow('rpc down');
    adminDb.setRpc('get_admin_analytics', { data: null });
    await expect(analytics.getAnalyticsData()).rejects.toThrow('Failed to load analytics data');
    requireAdminSession.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(analytics.getAnalyticsData()).rejects.toThrow('NEXT_REDIRECT');
  });
});

describe('Cloudinary media actions', () => {
  const CLOUD = 'https://res.cloudinary.com/dszrz6s6u/image/upload';
  const SUPA = 'https://proj.supabase.co/storage/v1/object/public';

  it('reads usage and pages the uploaded images', async () => {
    cloudinaryApi.usage.mockResolvedValue({ plan: 'Free' });
    expect(await media.getCloudinaryUsage()).toEqual({ success: true, usage: { plan: 'Free' } });
    cloudinaryApi.resources.mockResolvedValueOnce({ resources: [{ public_id: 'a' }], next_cursor: 'c2' });
    expect(await media.getCloudinaryResources()).toEqual({ success: true, assets: [{ public_id: 'a' }], nextCursor: 'c2' });
    expect(cloudinaryApi.resources).toHaveBeenCalledWith({ max_results: 100, type: 'upload' });
    cloudinaryApi.resources.mockResolvedValueOnce({});
    expect(await media.getCloudinaryResources('c2')).toEqual({ success: true, assets: [], nextCursor: null });
    expect(cloudinaryApi.resources).toHaveBeenLastCalledWith({ max_results: 100, type: 'upload', next_cursor: 'c2' });
  });

  it('reports Cloudinary errors, whether Errors, plain objects or nothing useful', async () => {
    cloudinaryApi.usage.mockRejectedValue(new Error('rate limited'));
    cloudinaryApi.resources.mockRejectedValue({ message: 'bad key', http_code: 401 });
    expect(await media.getCloudinaryUsage()).toEqual({ success: false, error: 'rate limited' });
    expect(await media.getCloudinaryResources()).toEqual({ success: false, error: 'bad key' });
    cloudinaryApi.usage.mockRejectedValue(null);
    cloudinaryApi.resources.mockRejectedValue({ message: '' });
    expect(await media.getCloudinaryUsage()).toEqual({ success: false, error: 'Could not read Cloudinary usage' });
    expect(await media.getCloudinaryResources()).toEqual({ success: false, error: 'Could not list Cloudinary files' });
  });

  it('deletes an image no prize or profile shows, and refuses one that is shown', async () => {
    adminDb.setTable('Prize', { data: [{ name: 'Bike', imageUrl: `${CLOUD}/t_1Think2win/v1/prizes/bike.jpg` }, { name: 'Odd', imageUrl: 'https://res.cloudinary.com/other/x.jpg' }] });
    adminDb.setTable('User', { data: [{ id: 'u1', profilePicture: `${CLOUD}/v2/avatars/u1.png` }, { id: 'u2', profilePicture: null }] });
    destroy.mockResolvedValue({ result: 'ok' });

    expect(await media.deleteCloudinaryResource('prizes/old')).toEqual({ success: true });
    expect(destroy).toHaveBeenCalledWith('prizes/old');
    expect(adminDb.callsTo('Prize')[0].ops).toContainEqual({ op: 'like', args: ['imageUrl', 'https://res.cloudinary.com/%'] });
    expect(adminDb.callsTo('User')[0].ops).toContainEqual({ op: 'like', args: ['profilePicture', 'https://res.cloudinary.com/%'] });

    expect(await media.deleteCloudinaryResource('prizes/bike')).toEqual({ success: false, error: 'Used by prize "Bike": change it there first' });
    expect(await media.deleteCloudinaryResource('avatars/u1')).toEqual({ success: false, error: "A player's profile picture: change it there first" });
    expect(destroy).toHaveBeenCalledTimes(1);
    adminDb.setTable('Prize', { data: null });
    expect(await media.deleteCloudinaryResource('prizes/bike')).toEqual({ success: true });

    destroy.mockReset().mockRejectedValue(new Error('not found'));
    expect(await media.deleteCloudinaryResource('x')).toEqual({ success: false, error: 'not found' });
    destroy.mockRejectedValue({});
    expect(await media.deleteCloudinaryResource('x')).toEqual({ success: false, error: 'Delete failed' });
  });

  it('does not delete when the in-use check cannot be made', async () => {
    adminDb.setTable('Prize', { data: null });
    adminDb.setTable('User', { error: { message: 'permission denied' } });
    expect(await media.deleteCloudinaryResource('x')).toEqual({ success: false, error: 'permission denied' });
    adminDb.setTable('Prize', { error: { message: 'no table' } });
    expect(await media.bulkDeleteCloudinaryResources(['x'])).toEqual({ success: false, error: 'no table' });
    expect(destroy).not.toHaveBeenCalled();
    expect(cloudinaryApi.delete_resources).not.toHaveBeenCalled();
  });

  it('bulk deletes up to 100 images, skipping those in use or not Cloudinary ids', async () => {
    adminDb.setTable('Prize', { data: [{ name: 'Bike', imageUrl: `${CLOUD}/prizes/bike.jpg` }] });
    adminDb.setTable('User', { data: null });
    cloudinaryApi.delete_resources.mockResolvedValue({ deleted: {} });

    const res = await media.bulkDeleteCloudinaryResources(['prizes/p1', 'prizes/bike', '', 7 as unknown as string]);
    expect(res).toEqual({
      success: true,
      deleted: ['prizes/p1'],
      skipped: [
        { publicId: 'prizes/bike', reason: 'Used by prize "Bike"' },
        { publicId: '', reason: 'Not a Cloudinary file' },
        { publicId: '7', reason: 'Not a Cloudinary file' },
      ],
    });
    expect(cloudinaryApi.delete_resources).toHaveBeenCalledWith(['prizes/p1']);

    // All skipped: nothing is sent to Cloudinary
    cloudinaryApi.delete_resources.mockClear();
    expect(await media.bulkDeleteCloudinaryResources(['prizes/bike'])).toMatchObject({ success: true, deleted: [] });
    expect(cloudinaryApi.delete_resources).not.toHaveBeenCalled();

    expect(await media.bulkDeleteCloudinaryResources([])).toEqual({ success: false, error: 'No resources provided' });
    expect(await media.bulkDeleteCloudinaryResources('x' as unknown as string[])).toEqual({ success: false, error: 'No resources provided' });
    const tooMany = Array.from({ length: 101 }, (_, i) => `p${i}`);
    expect(await media.bulkDeleteCloudinaryResources(tooMany)).toEqual({ success: false, error: 'Select at most 100 files at a time' });

    cloudinaryApi.delete_resources.mockRejectedValue(new Error('Cloudinary API down'));
    expect(await media.bulkDeleteCloudinaryResources(['p1'])).toEqual({ success: false, error: 'Cloudinary API down' });
    cloudinaryApi.delete_resources.mockRejectedValue('?');
    expect(await media.bulkDeleteCloudinaryResources(['p1'])).toEqual({ success: false, error: 'Bulk delete failed' });
  });

  it('copies a Cloudinary image into a Supabase bucket through the safe download', async () => {
    cloudinaryUrl.mockReturnValue(`${CLOUD}/prizes/phone`);
    fetchRemoteImage.mockResolvedValue(Buffer.from([1, 2, 3]));
    storeImage.mockResolvedValue({ url: `${SUPA}/prize-images/prizes/n-1280.webp`, paths: [], bytes: 3 });

    expect(await media.transferCloudinaryToSupabase('prizes/phone')).toEqual({ success: true, url: `${SUPA}/prize-images/prizes/n-1280.webp` });
    expect(cloudinaryUrl).toHaveBeenCalledWith('prizes/phone', { secure: true });
    expect(fetchRemoteImage).toHaveBeenCalledWith(`${CLOUD}/prizes/phone`);
    expect(storeImage).toHaveBeenCalledWith(adminDb.client, 'prize-images', 'prizes', Buffer.from([1, 2, 3]));
    await media.transferCloudinaryToSupabase('banners/top', 'site-media');
    expect(storeImage).toHaveBeenLastCalledWith(adminDb.client, 'site-media', 'uploads', expect.any(Buffer));

    expect(await media.transferCloudinaryToSupabase('x', 'avatars' as never)).toEqual({ success: false, error: 'Unknown media bucket' });
    expect(await media.transferCloudinaryToSupabase('')).toEqual({ success: false, error: 'Not a Cloudinary file' });
    expect(await media.transferCloudinaryToSupabase(3 as unknown as string)).toEqual({ success: false, error: 'Not a Cloudinary file' });
    expect(await media.transferCloudinaryToSupabase('../other/x')).toEqual({ success: false, error: 'Not a Cloudinary file' });

    fetchRemoteImage.mockRejectedValue(new Error('The image link answered 404'));
    expect(await media.transferCloudinaryToSupabase('gone')).toEqual({ success: false, error: 'The image link answered 404' });
    fetchRemoteImage.mockRejectedValue(undefined);
    expect(await media.transferCloudinaryToSupabase('gone')).toEqual({ success: false, error: 'Transfer failed' });
  });

  it("copies only this site's prize and site images into Cloudinary", async () => {
    upload.mockResolvedValue({ public_id: 'prizes/n-1280' });
    const url = `${SUPA}/prize-images/prizes/n-1280.webp`;
    expect(await media.transferSupabaseToCloudinary(url, 'prizes')).toEqual({ success: true, publicId: 'prizes/n-1280' });
    expect(upload).toHaveBeenCalledWith(url, { folder: 'prizes', resource_type: 'image' });
    await media.transferSupabaseToCloudinary(url);
    expect(upload).toHaveBeenLastCalledWith(url, { folder: 'transfers', resource_type: 'image' });

    const refused = { success: false, error: "Only this site's prize and site images can be copied" };
    expect(await media.transferSupabaseToCloudinary('https://evil.example/x.png', 'prizes')).toEqual(refused);
    expect(await media.transferSupabaseToCloudinary(`${SUPA}/avatars/u1/a-256.webp`, 'prizes')).toEqual(refused);
    expect(await media.transferSupabaseToCloudinary(url, '../x')).toEqual({ success: false, error: 'Folder names may use letters, digits, - and _ only' });
    expect(upload).toHaveBeenCalledTimes(2);

    upload.mockRejectedValue(new Error('quota'));
    expect(await media.transferSupabaseToCloudinary(url, 'prizes')).toEqual({ success: false, error: 'quota' });
    upload.mockRejectedValue(0);
    expect(await media.transferSupabaseToCloudinary(url, 'prizes')).toEqual({ success: false, error: 'Transfer failed' });
  });

  it('lists the newest prize and site images to pick from, or the first failure', async () => {
    listMediaImages
      .mockResolvedValueOnce({ success: true, data: { images: [{ url: 'https://sb/p1.webp', name: 'p1', size: 1024 }] } })
      .mockResolvedValueOnce({ success: true, data: { images: [{ url: 'https://sb/s1.webp', name: 's1', size: 10 }] } });
    expect(await media.getSupabaseMediaForPicker()).toEqual({
      success: true,
      images: [
        { url: 'https://sb/p1.webp', name: 'p1', bucket: 'prize-images', size: 1024 },
        { url: 'https://sb/s1.webp', name: 's1', bucket: 'site-media', size: 10 },
      ],
    });
    expect(listMediaImages).toHaveBeenCalledWith('prize-images', 0);
    expect(listMediaImages).toHaveBeenCalledWith('site-media', 0);

    listMediaImages.mockResolvedValueOnce({ success: false, error: 'storage down' }).mockResolvedValueOnce({ success: true, data: { images: [] } });
    expect(await media.getSupabaseMediaForPicker()).toEqual({ success: false, error: 'storage down' });
  });

  it('needs an admin session', async () => {
    requireAdminSession.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(media.getCloudinaryUsage()).rejects.toThrow();
    await expect(media.getCloudinaryResources()).rejects.toThrow();
    await expect(media.deleteCloudinaryResource('x')).rejects.toThrow();
    await expect(media.bulkDeleteCloudinaryResources(['x'])).rejects.toThrow();
    await expect(media.transferCloudinaryToSupabase('x')).rejects.toThrow();
    await expect(media.transferSupabaseToCloudinary('x')).rejects.toThrow();
    await expect(media.getSupabaseMediaForPicker()).rejects.toThrow();
    expect(destroy).not.toHaveBeenCalled();
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });
});

describe('requestPasswordSetupEmail', () => {
  it('emails the signed-in player a set-password link, rate limited per user', async () => {
    sendPasswordSetupEmail.mockResolvedValue({ ok: true });
    expect(await pwSetup.requestPasswordSetupEmail('tok')).toEqual({ success: true, email: 'ali@example.test' });
    expect(checkLimit).toHaveBeenCalledWith(expect.anything(), 'u1', '/profile/password-setup');
    expect(sendPasswordSetupEmail).toHaveBeenCalledWith(expect.anything(), 'ali@example.test', 'tok');
  });

  it('reports an expired session, the rate limit, a failed send and errors', async () => {
    checkLimit.mockResolvedValueOnce({ success: false });
    expect(await pwSetup.requestPasswordSetupEmail('tok')).toEqual({ error: 'Too many requests. Please wait a few minutes and try again.' });
    sendPasswordSetupEmail.mockResolvedValueOnce({ ok: false });
    expect((await pwSetup.requestPasswordSetupEmail('tok')).error).toMatch(/couldn't send the email/);
    sendPasswordSetupEmail.mockResolvedValueOnce({ ok: false, captchaFailed: true });
    expect(await pwSetup.requestPasswordSetupEmail('tok')).toEqual({ error: 'The security check failed or expired. Please try again.' });
    expect(await pwSetup.requestPasswordSetupEmail('')).toEqual({ error: 'Please complete the security check.' });
    checkLimit.mockRejectedValueOnce(new Error('x'));
    expect(await pwSetup.requestPasswordSetupEmail('tok')).toEqual({ error: 'An error occurred. Please try again.' });
    sb.setUser(null);
    expect(await pwSetup.requestPasswordSetupEmail('tok')).toEqual({ error: 'Your session has expired. Please sign in again.' });
  });
});
