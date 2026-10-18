// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  for (const fn of [requireAdminSession, cloudinaryApi.usage, cloudinaryApi.resources, cloudinaryApi.delete_resources, destroy, upload, cloudinaryUrl, storeImage, listMediaImages, sendPasswordSetupEmail, checkLimit]) fn.mockReset();
  requireAdminSession.mockResolvedValue('boss@example.test');
  checkLimit.mockResolvedValue({ success: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getAnalyticsData', () => {
  it('adds live-quiz engagement, the score distribution and notification efficacy to the RPC data', async () => {
    adminDb.setRpc('get_admin_analytics', { data: { revenue: [{ date: 'd', amount: 4 }] } });
    adminDb.setTable('Quiz', { data: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] });
    adminDb.setTable('QuizAttempt', (call) => (call.ops.some((o) => o.op === 'in') ? { count: 10 } : { data: [{ score: 0 }, { score: 20 }, { score: 35 }, { score: 60 }, { score: 61 }, { score: 99 }, { score: null }] }));
    adminDb.setTable('Notification', { data: [{ read: true }, { read: false }, { read: true }] });

    const data = await analytics.getAnalyticsData();

    expect(data.revenue).toEqual([{ date: 'd', amount: 4 }]);
    expect(data.liveQuizEngagement).toEqual({ totalLiveQuizzes: 3, totalLiveAttempts: 10, avgAttemptsPerLiveQuiz: 3 });
    expect(data.scoreDistribution).toEqual([
      { range: '0-20', count: 3 }, { range: '21-40', count: 1 }, { range: '41-60', count: 1 }, { range: '61-80', count: 1 }, { range: '81-100', count: 1 },
    ]);
    expect(data.notificationEfficacy).toEqual({ totalSent: 3, totalRead: 2, ctr: 67 });
  });

  it('measures notifications of type "quiz_results", which nothing ever creates', async () => {
    adminDb.setRpc('get_admin_analytics', { data: {} });
    await analytics.getAnalyticsData();
    expect(eqValue(adminDb.callsTo('Notification')[0], 'type')).toBe('quiz_results');
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
  it('reads usage, pages resources and deletes an asset', async () => {
    cloudinaryApi.usage.mockResolvedValue({ credits: 1 });
    expect(await media.getCloudinaryUsage()).toEqual({ success: true, usage: { credits: 1 } });
    cloudinaryApi.resources.mockResolvedValue({ resources: [] });
    await media.getCloudinaryResources();
    expect(cloudinaryApi.resources).toHaveBeenCalledWith({ max_results: 100, type: 'upload' });
    await media.getCloudinaryResources('next-page');
    expect(cloudinaryApi.resources).toHaveBeenLastCalledWith({ max_results: 100, type: 'upload', next_cursor: 'next-page' });
    destroy.mockResolvedValue({ result: 'ok' });
    expect(await media.deleteCloudinaryResource('prizes/phone')).toEqual({ success: true, result: { result: 'ok' } });
  });

  it('reports Cloudinary errors', async () => {
    cloudinaryApi.usage.mockRejectedValue(new Error('rate limited'));
    cloudinaryApi.resources.mockRejectedValue(new Error('rate limited'));
    destroy.mockRejectedValue(new Error('not found'));
    expect(await media.getCloudinaryUsage()).toEqual({ success: false, error: 'rate limited' });
    expect(await media.getCloudinaryResources()).toEqual({ success: false, error: 'rate limited' });
    expect(await media.deleteCloudinaryResource('x')).toEqual({ success: false, error: 'not found' });
  });

  it('bulk deletes assets from Cloudinary', async () => {
    cloudinaryApi.delete_resources.mockResolvedValue({ deleted: { 'prizes/p1': 'deleted', 'prizes/p2': 'deleted' } });
    const res = await media.bulkDeleteCloudinaryResources(['prizes/p1', 'prizes/p2']);
    expect(res).toEqual({ success: true, result: { deleted: { 'prizes/p1': 'deleted', 'prizes/p2': 'deleted' } } });
    expect(cloudinaryApi.delete_resources).toHaveBeenCalledWith(['prizes/p1', 'prizes/p2']);

    expect(await media.bulkDeleteCloudinaryResources([])).toEqual({ success: false, error: 'No resources provided' });

    cloudinaryApi.delete_resources.mockRejectedValue(new Error('Cloudinary API down'));
    expect(await media.bulkDeleteCloudinaryResources(['p1'])).toEqual({ success: false, error: 'Cloudinary API down' });
  });

  it('uploads an image to Cloudinary', async () => {
    upload.mockResolvedValue({
      public_id: 'prizes/new-item',
      secure_url: 'https://res.cloudinary.com/demo/image/upload/prizes/new-item.png',
      format: 'png',
      bytes: 1024,
      width: 100,
      height: 100,
      created_at: '2026-10-18T00:00:00Z',
    });

    const formData = new FormData();
    const file = new File(['fake-content'], 'test.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('folder', 'prizes');

    const result = await media.uploadToCloudinary(formData);
    expect(result.success).toBe(true);
    expect(upload).toHaveBeenCalledWith(expect.stringContaining('data:image/png;base64,'), {
      folder: 'prizes',
      resource_type: 'image',
    });

    const emptyForm = new FormData();
    expect(await media.uploadToCloudinary(emptyForm)).toEqual({ success: false, error: 'No file provided' });
  });

  it('transfers an image between Cloudinary and Supabase Storage', async () => {
    cloudinaryUrl.mockReturnValue('https://res.cloudinary.com/demo/image/upload/prizes/phone.png');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    storeImage.mockResolvedValue({
      url: 'https://test.supabase.co/storage/v1/object/public/prize-images/prizes/123-1280.webp',
      paths: ['prizes/123-1280.webp'],
      bytes: 2048,
    });

    const cToS = await media.transferCloudinaryToSupabase('prizes/phone', 'prize-images');
    expect(cToS.success).toBe(true);
    expect(storeImage).toHaveBeenCalledWith(expect.anything(), 'prize-images', 'prizes', expect.any(Buffer));

    upload.mockResolvedValue({
      public_id: 'transfers/synced-img',
      secure_url: 'https://res.cloudinary.com/demo/image/upload/transfers/synced-img.webp',
      format: 'webp',
      bytes: 2048,
      width: 800,
      height: 600,
    });
    const sToC = await media.transferSupabaseToCloudinary('https://test.supabase.co/img.webp', 'transfers');
    expect(sToC.success).toBe(true);
    expect(upload).toHaveBeenCalledWith('https://test.supabase.co/img.webp', { folder: 'transfers', resource_type: 'image' });

    listMediaImages.mockResolvedValue({
      success: true,
      data: { images: [{ url: 'https://sb/p1.webp', name: 'p1', size: 1024 }] },
    });
    const picker = await media.getSupabaseMediaForPicker();
    expect(picker.success).toBe(true);
    expect(picker.images.length).toBeGreaterThan(0);
  });

  it('needs an admin session', async () => {
    requireAdminSession.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(media.getCloudinaryUsage()).rejects.toThrow();
    await expect(media.getCloudinaryResources()).rejects.toThrow();
    await expect(media.deleteCloudinaryResource('x')).rejects.toThrow();
    await expect(media.uploadToCloudinary(new FormData())).rejects.toThrow();
    await expect(media.transferCloudinaryToSupabase('x')).rejects.toThrow();
    await expect(media.transferSupabaseToCloudinary('x')).rejects.toThrow();
    await expect(media.getSupabaseMediaForPicker()).rejects.toThrow();
    expect(destroy).not.toHaveBeenCalled();
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
