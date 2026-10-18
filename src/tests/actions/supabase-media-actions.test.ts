// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
const assertAdmin = vi.fn();
const userDb = { update: vi.fn() };
const queue = {
  cancelMediaDeletion: vi.fn(),
  getPrizeImageRetentionDays: vi.fn(),
  listMediaDeletions: vi.fn(),
  setPrizeImageRetentionDays: vi.fn(),
};
const store = {
  deleteStoredImage: vi.fn(),
  getBucketUsage: vi.fn(),
  listStoredObjects: vi.fn(),
  removeFolderExcept: vi.fn(),
};

vi.mock('@/lib/admin-guard', () => ({ assertAdmin: () => assertAdmin() }));
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => db.client, userDb }));
vi.mock('@/lib/media/storage.server', async (orig) => ({
  ...(await orig<typeof import('@/lib/media/storage.server')>()),
  deleteStoredImage: (...a: unknown[]) => store.deleteStoredImage(...a),
  getBucketUsage: (...a: unknown[]) => store.getBucketUsage(...a),
  listStoredObjects: (...a: unknown[]) => store.listStoredObjects(...a),
  removeFolderExcept: (...a: unknown[]) => store.removeFolderExcept(...a),
}));
vi.mock('@/lib/media/deletion-queue', async (orig) => ({
  ...(await orig<typeof import('@/lib/media/deletion-queue')>()),
  cancelMediaDeletion: (...a: unknown[]) => queue.cancelMediaDeletion(...a),
  getPrizeImageRetentionDays: (...a: unknown[]) => queue.getPrizeImageRetentionDays(...a),
  listMediaDeletions: (...a: unknown[]) => queue.listMediaDeletions(...a),
  setPrizeImageRetentionDays: (...a: unknown[]) => queue.setPrizeImageRetentionDays(...a),
}));

const actions = await import('@/actions/supabase-media-actions');

const PUB = 'https://proj.supabase.co/storage/v1/object/public';
const DENIED = { success: false, error: 'Unauthorized: admin session required' };

beforeEach(() => {
  db = createSupabaseMock();
  for (const fn of [assertAdmin, userDb.update, ...Object.values(queue), ...Object.values(store)]) fn.mockReset();
  assertAdmin.mockResolvedValue('admin@example.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('admin guard', () => {
  it('every action refuses without an admin session and touches nothing', async () => {
    assertAdmin.mockRejectedValue(new Error('no session'));
    for (const call of [
      () => actions.getMediaOverview(),
      () => actions.listMediaImages('prize-images'),
      () => actions.deleteMediaImage(`${PUB}/site-media/uploads/a-1920.webp`),
      () => actions.listProfilePictures(),
      () => actions.removeProfilePicture('u1'),
      () => actions.keepQueuedImage('d1'),
      () => actions.updatePrizeImageRetention(7),
    ]) {
      expect(await call()).toEqual(DENIED);
    }
    expect(db.calls).toHaveLength(0);
    expect(store.deleteStoredImage).not.toHaveBeenCalled();
    expect(store.removeFolderExcept).not.toHaveBeenCalled();
  });
});

describe('overview and retention', () => {
  it('returns usage, retention and the deletion queue', async () => {
    store.getBucketUsage.mockResolvedValue([{ bucket: 'avatars', objects: 2, bytes: 10 }]);
    queue.getPrizeImageRetentionDays.mockResolvedValue(30);
    queue.listMediaDeletions.mockResolvedValue([{ id: 'd1' }]);
    expect(await actions.getMediaOverview()).toEqual({
      success: true,
      data: { usage: [{ bucket: 'avatars', objects: 2, bytes: 10 }], retentionDays: 30, deletions: [{ id: 'd1' }] },
    });
    store.getBucketUsage.mockRejectedValue(new Error('function media_storage_usage does not exist'));
    expect(await actions.getMediaOverview()).toEqual({ success: false, error: 'function media_storage_usage does not exist' });
    store.getBucketUsage.mockRejectedValue({ code: 'weird' });
    expect(await actions.getMediaOverview()).toEqual({ success: false, error: 'Something went wrong' });
  });

  it('saves the retention days as the signed-in admin and keeps queued images', async () => {
    queue.setPrizeImageRetentionDays.mockResolvedValue(undefined);
    expect(await actions.updatePrizeImageRetention(14)).toEqual({ success: true, data: { days: 14 } });
    expect(queue.setPrizeImageRetentionDays).toHaveBeenCalledWith(14, 'admin@example.test');
    queue.setPrizeImageRetentionDays.mockRejectedValue(new RangeError('Retention must be a whole number of days from 0 to 365'));
    expect(await actions.updatePrizeImageRetention(999)).toEqual({ success: false, error: 'Retention must be a whole number of days from 0 to 365' });

    queue.cancelMediaDeletion.mockResolvedValue(true);
    expect(await actions.keepQueuedImage('d1')).toEqual({ success: true, data: { kept: true } });
    expect(queue.cancelMediaDeletion).toHaveBeenCalledWith('d1');
  });
});

describe('listMediaImages', () => {
  it('lists one row per prize image with the prizes that use it', async () => {
    store.listStoredObjects.mockResolvedValue({
      objects: [
        { name: 'prizes/a-1280.webp', size: 900, createdAt: '2026-10-01' },
        { name: 'prizes/b-1280.webp', size: 500, createdAt: '2026-09-01' },
      ],
      total: 50,
    });
    db.setTable('Prize', { data: [
      { id: 'p1', name: 'Bike', imageUrl: `${PUB}/prize-images/prizes/a-1280.webp` },
      { id: 'p2', name: 'Phone', imageUrl: 'https://res.cloudinary.com/dszrz6s6u/image/upload/x.jpg' },
    ] });
    const res = await actions.listMediaImages('prize-images', 1);
    expect(store.listStoredObjects).toHaveBeenCalledWith(db.client, 'prize-images', { suffix: '-1280.webp', limit: 48, offset: 48 });
    expect(res).toEqual({
      success: true,
      data: {
        images: [
          { url: `${PUB}/prize-images/prizes/a-1280.webp`, name: 'prizes/a-1280.webp', size: 900, createdAt: '2026-10-01', usedBy: [{ id: 'p1', name: 'Bike' }] },
          { url: `${PUB}/prize-images/prizes/b-1280.webp`, name: 'prizes/b-1280.webp', size: 500, createdAt: '2026-09-01', usedBy: [] },
        ],
        total: 50,
        pageSize: 48,
      },
    });

    db.setTable('Prize', { data: null });
    expect((await actions.listMediaImages('prize-images', -3.7)).success).toBe(true);
    expect(store.listStoredObjects).toHaveBeenLastCalledWith(db.client, 'prize-images', expect.objectContaining({ offset: 0 }));
    db.setTable('Prize', { error: { message: 'prizes unreadable' } });
    expect(await actions.listMediaImages('prize-images')).toEqual({ success: false, error: 'Something went wrong' });
  });

  it('site images skip the prize lookup; other buckets are refused', async () => {
    store.listStoredObjects.mockResolvedValue({ objects: [{ name: 'uploads/s-1920.webp', size: 1, createdAt: 'c' }], total: 1 });
    const res = await actions.listMediaImages('site-media');
    expect(res.success && res.data.images[0]).toMatchObject({ url: `${PUB}/site-media/uploads/s-1920.webp`, usedBy: [] });
    expect(store.listStoredObjects).toHaveBeenCalledWith(db.client, 'site-media', { suffix: '-1920.webp', limit: 48, offset: 0 });
    expect(db.callsTo('Prize')).toHaveLength(0);
    expect(await actions.listMediaImages('avatars' as never)).toEqual({ success: false, error: 'Unknown media bucket' });
  });
});

describe('deleteMediaImage', () => {
  it('deletes unused admin images and refuses images a prize still shows', async () => {
    store.deleteStoredImage.mockResolvedValue(true);
    expect(await actions.deleteMediaImage(`${PUB}/site-media/uploads/a-1920.webp`)).toEqual({ success: true, data: { deleted: true } });
    expect(db.callsTo('Prize')).toHaveLength(0);

    db.setTable('Prize', { data: [{ name: 'Bike', imageUrl: `${PUB}/prize-images/prizes/a-1280.webp` }] });
    expect(await actions.deleteMediaImage(`${PUB}/prize-images/prizes/a-640.webp`)).toEqual({
      success: false,
      error: '"Bike" still uses this image. Change the prize\'s image first.',
    });
    expect(store.deleteStoredImage).toHaveBeenCalledTimes(1);
    expect(await actions.deleteMediaImage(`${PUB}/prize-images/prizes/b-1280.webp`)).toEqual({ success: true, data: { deleted: true } });
    expect(store.deleteStoredImage).toHaveBeenLastCalledWith(db.client, `${PUB}/prize-images/prizes/b-1280.webp`);
    db.setTable('Prize', { data: null });
    expect((await actions.deleteMediaImage(`${PUB}/prize-images/prizes/c-1280.webp`)).success).toBe(true);
    db.setTable('Prize', { error: { message: 'x' } });
    expect((await actions.deleteMediaImage(`${PUB}/prize-images/prizes/c-1280.webp`)).success).toBe(false);
  });

  it('never deletes player avatars or foreign URLs from here', async () => {
    for (const url of [`${PUB}/avatars/u1/a-256.webp`, 'https://res.cloudinary.com/dszrz6s6u/image/upload/a.jpg']) {
      expect(await actions.deleteMediaImage(url)).toEqual({ success: false, error: 'Not an admin media image' });
    }
    expect(store.deleteStoredImage).not.toHaveBeenCalled();
  });
});

describe('profile pictures', () => {
  it('lists avatars with their player and whether the profile still points at them', async () => {
    store.listStoredObjects.mockResolvedValue({
      objects: [
        { name: 'u1/a-256.webp', size: 10, createdAt: 'c1' },
        { name: 'u1/old-256.webp', size: 11, createdAt: 'c0' },
        { name: 'gone/x-256.webp', size: 12, createdAt: 'c2' },
      ],
      total: 3,
    });
    db.setTable('User', { data: [{ id: 'u1', name: 'Ali', email: 'ali@example.test', profilePicture: `${PUB}/avatars/u1/a-256.webp` }] });
    const res = await actions.listProfilePictures(0);
    expect(store.listStoredObjects).toHaveBeenCalledWith(db.client, 'avatars', { limit: 48, offset: 0 });
    expect(db.callsTo('User')[0].ops.find((o) => o.op === 'in')?.args).toEqual(['id', ['u1', 'gone']]);
    expect(res).toEqual({
      success: true,
      data: {
        pictures: [
          { userId: 'u1', userName: 'Ali', email: 'ali@example.test', url: `${PUB}/avatars/u1/a-256.webp`, size: 10, createdAt: 'c1', isCurrent: true },
          { userId: 'u1', userName: 'Ali', email: 'ali@example.test', url: `${PUB}/avatars/u1/old-256.webp`, size: 11, createdAt: 'c0', isCurrent: false },
          { userId: 'gone', userName: null, email: null, url: `${PUB}/avatars/gone/x-256.webp`, size: 12, createdAt: 'c2', isCurrent: false },
        ],
        total: 3,
        pageSize: 48,
      },
    });
  });

  it('skips the user lookup on an empty page and reports lookup failures', async () => {
    store.listStoredObjects.mockResolvedValue({ objects: [], total: 0 });
    expect(await actions.listProfilePictures(2)).toEqual({ success: true, data: { pictures: [], total: 0, pageSize: 48 } });
    expect(db.callsTo('User')).toHaveLength(0);
    store.listStoredObjects.mockResolvedValue({ objects: [{ name: 'u1/a-256.webp', size: 1, createdAt: 'c' }], total: 1 });
    db.setTable('User', { data: null });
    expect((await actions.listProfilePictures()).success).toBe(true);
    db.setTable('User', { error: { message: 'x' } });
    expect((await actions.listProfilePictures()).success).toBe(false);
  });

  it('moderation removes the files and clears the profile only when it points into that folder', async () => {
    store.removeFolderExcept.mockResolvedValue(['u1/a-256.webp']);
    db.setTable('User', { data: { profilePicture: `${PUB}/avatars/u1/a-256.webp` } });
    expect(await actions.removeProfilePicture('u1')).toEqual({ success: true, data: { removed: 1 } });
    expect(eqValue(db.callsTo('User')[0], 'id')).toBe('u1');
    expect(userDb.update).toHaveBeenCalledWith('u1', { profilePicture: null });
    expect(store.removeFolderExcept).toHaveBeenCalledWith(db.client, 'avatars', 'u1');

    userDb.update.mockClear();
    for (const profilePicture of ['https://lh3.googleusercontent.com/a.png', `${PUB}/avatars/u2/a-256.webp`, null]) {
      db.setTable('User', { data: { profilePicture } });
      expect((await actions.removeProfilePicture('u1')).success).toBe(true);
    }
    db.setTable('User', { data: null });
    expect((await actions.removeProfilePicture('u1')).success).toBe(true);
    expect(userDb.update).not.toHaveBeenCalled();

    db.setTable('User', { error: { message: 'x' } });
    expect((await actions.removeProfilePicture('u1')).success).toBe(false);
    expect(await actions.removeProfilePicture('../prize-images')).toEqual({ success: false, error: 'Invalid user id' });
    expect(store.removeFolderExcept).toHaveBeenCalledTimes(5);
  });
});
