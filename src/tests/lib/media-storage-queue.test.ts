// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
const toWebpVariants = vi.fn();
const deleteCloudinaryImageByUrl = vi.fn();

vi.mock('@/lib/media/image-processing', async (orig) => ({
  ...(await orig<typeof import('@/lib/media/image-processing')>()),
  toWebpVariants: (...a: unknown[]) => toWebpVariants(...a),
}));
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => db.client }));
vi.mock('@/lib/cloudinary-server', () => ({ deleteCloudinaryImageByUrl: (...a: unknown[]) => deleteCloudinaryImageByUrl(...a) }));

const storage = await import('@/lib/media/storage.server');
const queue = await import('@/lib/media/deletion-queue');

const PUB = 'https://proj.supabase.co/storage/v1/object/public';
const PRIZE = `${PUB}/prize-images/prizes/old-1280.webp`;
const CLOUD = 'https://res.cloudinary.com/dszrz6s6u/image/upload/t_1Think2win/f_auto/q_auto/Honda_CD70_tqpzdr.jpg';
const variants = [
  { width: 320, data: Buffer.alloc(10) },
  { width: 640, data: Buffer.alloc(20) },
  { width: 1280, data: Buffer.alloc(30) },
];

beforeEach(() => {
  db = createSupabaseMock();
  toWebpVariants.mockReset().mockResolvedValue(variants);
  deleteCloudinaryImageByUrl.mockReset().mockResolvedValue(true);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
  queue.resetMediaCleanupSchedule();
});
afterEach(() => vi.unstubAllEnvs());

describe('storeImage', () => {
  it('uploads every size as cache-forever WebP under one new id and returns the largest', async () => {
    const res = await storage.storeImage(db.client as never, 'prize-images', 'prizes', Buffer.from('img'));
    expect(toWebpVariants).toHaveBeenCalledWith(Buffer.from('img'), { widths: [320, 640, 1280], fit: 'inside' });
    const paths = db.storage.upload.mock.calls.map((c) => (c as unknown[])[0] as string);
    expect(paths).toHaveLength(3);
    const id = /^prizes\/(.+)-320\.webp$/.exec(paths[0])![1];
    expect(paths).toEqual([`prizes/${id}-320.webp`, `prizes/${id}-640.webp`, `prizes/${id}-1280.webp`]);
    expect(db.storage.upload).toHaveBeenCalledWith(paths[0], variants[0].data, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
    expect(res).toEqual({ url: `${PUB}/prize-images/prizes/${id}-1280.webp`, paths, bytes: 60 });
    expect(db.client.storage.from).toHaveBeenCalledWith('prize-images');
  });

  it('removes the sizes that did upload when one fails, and still reports the failure', async () => {
    const boom = { message: 'mime type not allowed' };
    db.storage.upload
      .mockResolvedValueOnce({ data: { path: 'a' }, error: null })
      .mockResolvedValueOnce({ data: null, error: boom } as never)
      .mockResolvedValueOnce({ data: { path: 'c' }, error: null });
    await expect(storage.storeImage(db.client as never, 'prize-images', 'prizes', Buffer.from('x'))).rejects.toBe(boom);
    const removed = (db.storage.remove.mock.calls[0] as unknown[])[0] as string[];
    expect(removed).toHaveLength(2);
    expect(removed[0]).toMatch(/-320\.webp$/);
    expect(removed[1]).toMatch(/-1280\.webp$/);

    // Clean-up failing too must not hide the original error; nothing uploaded -> nothing removed
    db.storage.remove.mockClear().mockRejectedValueOnce(new Error('network'));
    db.storage.upload.mockResolvedValueOnce({ data: { path: 'a' }, error: null }).mockResolvedValueOnce({ data: null, error: boom } as never).mockResolvedValueOnce({ data: null, error: boom } as never);
    await expect(storage.storeImage(db.client as never, 'prize-images', 'prizes', Buffer.from('x'))).rejects.toBe(boom);
    toWebpVariants.mockResolvedValueOnce([{ width: 256, data: Buffer.alloc(1) }]);
    db.storage.remove.mockClear();
    db.storage.upload.mockResolvedValueOnce({ data: null, error: boom } as never);
    await expect(storage.storeImage(db.client as never, 'avatars', 'u1', Buffer.from('x'))).rejects.toBe(boom);
    expect(db.storage.remove).not.toHaveBeenCalled();
  });
});

describe('deleteStoredImage / removeFolderExcept', () => {
  it('deletes every size of a media image and ignores other URLs', async () => {
    expect(await storage.deleteStoredImage(db.client as never, `${PUB}/prize-images/prizes/abc-640.webp`)).toBe(true);
    expect(db.storage.remove).toHaveBeenCalledWith(['prizes/abc-320.webp', 'prizes/abc-640.webp', 'prizes/abc-1280.webp']);
    expect(await storage.deleteStoredImage(db.client as never, CLOUD)).toBe(false);
    db.storage.remove.mockResolvedValueOnce({ data: null, error: { message: 'denied' } } as never);
    await expect(storage.deleteStoredImage(db.client as never, PRIZE)).rejects.toEqual({ message: 'denied' });
  });

  it('clears a folder except the files to keep, skipping sub-folders', async () => {
    db.storage.list.mockResolvedValueOnce({
      data: [{ id: '1', name: 'new-256.webp' }, { id: '2', name: 'old-256.webp' }, { id: null, name: 'nested' }],
      error: null,
    } as never);
    expect(await storage.removeFolderExcept(db.client as never, 'avatars', 'u1', ['u1/new-256.webp'])).toEqual(['u1/old-256.webp']);
    expect(db.storage.list).toHaveBeenCalledWith('u1', { limit: 1000 });
    expect(db.storage.remove).toHaveBeenCalledWith(['u1/old-256.webp']);

    db.storage.remove.mockClear();
    db.storage.list.mockResolvedValueOnce({ data: null, error: null } as never);
    expect(await storage.removeFolderExcept(db.client as never, 'avatars', 'u1')).toEqual([]);
    expect(db.storage.remove).not.toHaveBeenCalled();

    db.storage.list.mockResolvedValueOnce({ data: null, error: { message: 'list denied' } } as never);
    await expect(storage.removeFolderExcept(db.client as never, 'avatars', 'u1')).rejects.toEqual({ message: 'list denied' });
    db.storage.list.mockResolvedValueOnce({ data: [{ id: '1', name: 'a.webp' }], error: null } as never);
    db.storage.remove.mockResolvedValueOnce({ data: null, error: { message: 'remove denied' } } as never);
    await expect(storage.removeFolderExcept(db.client as never, 'avatars', 'u1')).rejects.toEqual({ message: 'remove denied' });
  });
});

describe('bucket listings (service-role RPCs)', () => {
  it('reports usage for all three buckets, zero for empty ones', async () => {
    db.setRpc('media_storage_usage', { data: [{ bucket_id: 'prize-images', object_count: '3', total_bytes: '13000' }] });
    expect(await storage.getBucketUsage(db.client as never)).toEqual([
      { bucket: 'site-media', objects: 0, bytes: 0 },
      { bucket: 'prize-images', objects: 3, bytes: 13000 },
      { bucket: 'avatars', objects: 0, bytes: 0 },
    ]);
    db.setRpc('media_storage_usage', { data: null });
    expect((await storage.getBucketUsage(db.client as never))[0]).toEqual({ bucket: 'site-media', objects: 0, bytes: 0 });
    db.setRpc('media_storage_usage', { error: { message: 'function missing' } });
    await expect(storage.getBucketUsage(db.client as never)).rejects.toEqual({ message: 'function missing' });
  });

  it('lists objects with defaults and paging, and maps rows', async () => {
    db.setRpc('media_storage_objects', { data: [{ name: 'prizes/a-1280.webp', size: '900', created_at: '2026-10-01', total_count: '7' }] });
    expect(await storage.listStoredObjects(db.client as never, 'prize-images', { suffix: '-1280.webp', limit: 2, offset: 4, prefix: 'prizes/' })).toEqual({
      objects: [{ name: 'prizes/a-1280.webp', size: 900, createdAt: '2026-10-01' }],
      total: 7,
    });
    expect(db.rpcCalls[0]).toEqual({ fn: 'media_storage_objects', args: { p_bucket: 'prize-images', p_prefix: 'prizes/', p_suffix: '-1280.webp', p_limit: 2, p_offset: 4 } });
    db.setRpc('media_storage_objects', { data: null });
    expect(await storage.listStoredObjects(db.client as never, 'avatars')).toEqual({ objects: [], total: 0 });
    expect(db.rpcCalls[1].args).toEqual({ p_bucket: 'avatars', p_prefix: '', p_suffix: '', p_limit: 100, p_offset: 0 });
    db.setRpc('media_storage_objects', { error: { message: 'nope' } });
    await expect(storage.listStoredObjects(db.client as never, 'avatars')).rejects.toEqual({ message: 'nope' });
    expect(storage.canonicalSuffix('site-media')).toBe('-1920.webp');
  });
});

describe('retention setting', () => {
  it('parses whole days 0..365 only', () => {
    expect(queue.parseRetentionDays('30')).toBe(30);
    expect(queue.parseRetentionDays(' 0 ')).toBe(0);
    expect(queue.parseRetentionDays(365)).toBe(365);
    for (const bad of ['366', '-1', '1.5', 'abc', '', null, undefined, 1.5, Number.NaN, '0030']) {
      expect(queue.parseRetentionDays(bad)).toBeNull();
    }
  });

  it('reads the AppSettings value, falling back to 30 days', async () => {
    db.setTable('AppSettings', { data: { value: '7' } });
    expect(await queue.getPrizeImageRetentionDays()).toBe(7);
    expect(eqValue(db.callsTo('AppSettings')[0], 'key')).toBe('prize_image_retention_days');
    db.setTable('AppSettings', { data: null });
    expect(await queue.getPrizeImageRetentionDays()).toBe(30);
    db.setTable('AppSettings', { data: { value: 'forever' } });
    expect(await queue.getPrizeImageRetentionDays()).toBe(30);
    db.setTable('AppSettings', { error: { message: 'down' } });
    await expect(queue.getPrizeImageRetentionDays()).rejects.toEqual({ message: 'down' });
  });

  it('saves a valid value with who changed it, refusing others', async () => {
    await queue.setPrizeImageRetentionDays(14, 'admin@example.test');
    expect(argOf(db.callsTo('AppSettings', 'upsert')[0], 'upsert')).toMatchObject({ key: 'prize_image_retention_days', value: '14', updatedBy: 'admin@example.test' });
    await expect(queue.setPrizeImageRetentionDays(400, 'a')).rejects.toBeInstanceOf(RangeError);
    await expect(queue.setPrizeImageRetentionDays(2.5, 'a')).rejects.toThrow('0 to 365');
    db.setTable('AppSettings', { error: { message: 'write failed' } });
    await expect(queue.setPrizeImageRetentionDays(1, 'a')).rejects.toEqual({ message: 'write failed' });
  });
});

describe('queueing prize images', () => {
  it('only prize-images files and non-asset Cloudinary images are deletable', () => {
    expect(queue.deletablePrizeImageKey(`${PUB}/prize-images/prizes/abc-320.webp`)).toBe('prize-images/prizes/abc');
    expect(queue.deletablePrizeImageKey(CLOUD)).toBe('cloudinary/Honda_CD70_tqpzdr');
    expect(queue.deletablePrizeImageKey(`${PUB}/site-media/uploads/abc-1920.webp`)).toBeNull();
    expect(queue.deletablePrizeImageKey('https://res.cloudinary.com/dszrz6s6u/image/upload/v1/assets/logo.png')).toBeNull();
    expect(queue.deletablePrizeImageKey('data:image/png;base64,AAAA')).toBeNull();
    expect(queue.deletablePrizeImageKey('/bike.svg')).toBeNull();
    expect(queue.deletablePrizeImageKey(null)).toBeNull();
  });

  it('inserts a pending row for deletable images and skips the rest', async () => {
    expect(await queue.schedulePrizeImageDeletion(PRIZE, 'prize_image_replaced', 'prize-1')).toBe(true);
    expect(argOf(db.callsTo('MediaDeletion', 'insert')[0], 'insert')).toMatchObject({ url: PRIZE, reason: 'prize_image_replaced', prizeId: 'prize-1', id: expect.any(String) });
    expect(await queue.schedulePrizeImageDeletion('/bike.svg', 'prize_deleted', 'p')).toBe(false);
    expect(await queue.schedulePrizeImageDeletion(null, 'prize_deleted', 'p')).toBe(false);
    expect(db.callsTo('MediaDeletion', 'insert')).toHaveLength(1);
    db.setTable('MediaDeletion', { error: { message: 'table missing' } });
    await expect(queue.schedulePrizeImageDeletion(CLOUD, 'prize_deleted', 'p')).rejects.toEqual({ message: 'table missing' });
  });

  it('lists recent queue rows and keeps (cancels) pending ones', async () => {
    db.setTable('MediaDeletion', { data: [{ id: 'd1' }] });
    expect(await queue.listMediaDeletions(5)).toEqual([{ id: 'd1' }]);
    expect(argOf(db.callsTo('MediaDeletion')[0], 'limit')).toBe(5);
    db.setTable('MediaDeletion', { data: null });
    expect(await queue.listMediaDeletions()).toEqual([]);
    db.setTable('MediaDeletion', { error: { message: 'x' } });
    await expect(queue.listMediaDeletions()).rejects.toEqual({ message: 'x' });

    db.setTable('MediaDeletion', { data: [{ id: 'd1' }] });
    expect(await queue.cancelMediaDeletion('d1')).toBe(true);
    const cancel = db.callsTo('MediaDeletion', 'update').at(-1);
    expect(argOf(cancel, 'update')).toMatchObject({ status: 'cancelled' });
    expect(eqValue(cancel, 'status')).toBe('pending');
    db.setTable('MediaDeletion', { data: null });
    expect(await queue.cancelMediaDeletion('d1')).toBe(false);
    db.setTable('MediaDeletion', { error: { message: 'y' } });
    await expect(queue.cancelMediaDeletion('d1')).rejects.toEqual({ message: 'y' });
  });
});

describe('processDueMediaDeletions', () => {
  const NOW = Date.parse('2026-10-18T12:00:00Z');
  const due = (rows: unknown[]) => (call: { ops: { op: string }[] }) =>
    call.ops.some((o) => o.op === 'select') && !call.ops.some((o) => o.op === 'update') ? { data: rows } : { data: null };

  it('uses the retention days for the cutoff and stops early when nothing is due', async () => {
    db.setTable('AppSettings', { data: { value: '10' } });
    db.setTable('MediaDeletion', { data: [] });
    expect(await queue.processDueMediaDeletions(NOW)).toEqual({ deleted: [], kept: [], failed: [] });
    const select = db.callsTo('MediaDeletion')[0];
    expect(select.ops.find((o) => o.op === 'lte')?.args).toEqual(['createdAt', '2026-10-08T12:00:00.000Z']);
    expect(eqValue(select, 'status')).toBe('pending');
    expect(db.callsTo('Prize')).toHaveLength(0);
    db.setTable('MediaDeletion', { data: null });
    expect((await queue.processDueMediaDeletions(NOW)).deleted).toEqual([]);
    db.setTable('MediaDeletion', { error: { message: 'q' } });
    await expect(queue.processDueMediaDeletions(NOW)).rejects.toEqual({ message: 'q' });
  });

  it('deletes unused images, keeps ones a prize uses again, and records the outcome', async () => {
    db.setTable('MediaDeletion', due([
      { id: 'supabase', url: PRIZE, attempts: 0 },
      { id: 'cloud', url: CLOUD, attempts: 0 },
      { id: 'reused', url: `${PUB}/prize-images/prizes/back-320.webp`, attempts: 0 },
      { id: 'foreign', url: 'https://elsewhere.example/a.png', attempts: 0 },
    ]));
    db.setTable('Prize', { data: [{ imageUrl: `${PUB}/prize-images/prizes/back-1280.webp` }, { imageUrl: null }] });

    expect(await queue.processDueMediaDeletions(NOW)).toEqual({ deleted: ['supabase', 'cloud'], kept: ['reused', 'foreign'], failed: [] });
    expect(db.storage.remove).toHaveBeenCalledWith(['prizes/old-320.webp', 'prizes/old-640.webp', 'prizes/old-1280.webp']);
    expect(deleteCloudinaryImageByUrl).toHaveBeenCalledWith(CLOUD);
    const updates = db.callsTo('MediaDeletion', 'update');
    expect(updates.map((u) => [eqValue(u, 'id'), (argOf(u, 'update') as { status: string }).status])).toEqual([
      ['supabase', 'deleted'], ['cloud', 'deleted'], ['reused', 'kept'], ['foreign', 'kept'],
    ]);
    expect(updates.every((u) => eqValue(u, 'status') === 'pending')).toBe(true);
    expect(argOf(updates[0], 'update')).toMatchObject({ processedAt: '2026-10-18T12:00:00.000Z' });
  });

  it('retries failures and gives up after five attempts', async () => {
    db.setTable('MediaDeletion', due([
      { id: 'retry', url: PRIZE, attempts: 0 },
      { id: 'give-up', url: CLOUD, attempts: 4 },
      { id: 'string-error', url: `${PUB}/prize-images/prizes/z-1280.webp`, attempts: 1 },
    ]));
    db.setTable('Prize', { data: null });
    db.storage.remove
      .mockResolvedValueOnce({ data: null, error: new Error('storage 503') } as never)
      .mockRejectedValueOnce('plain failure');
    deleteCloudinaryImageByUrl.mockResolvedValueOnce(false);

    expect(await queue.processDueMediaDeletions(NOW)).toEqual({ deleted: [], kept: [], failed: ['retry', 'give-up', 'string-error'] });
    const patches = db.callsTo('MediaDeletion', 'update').map((u) => argOf(u, 'update'));
    expect(patches[0]).toEqual({ attempts: 1, lastError: 'storage 503' });
    expect(patches[1]).toEqual({ attempts: 5, lastError: 'Storage did not confirm the delete (already removed?)', status: 'failed', processedAt: '2026-10-18T12:00:00.000Z' });
    expect(patches[2]).toEqual({ attempts: 2, lastError: 'plain failure' });
  });

  it('does not delete anything when the prize list cannot be read', async () => {
    db.setTable('MediaDeletion', due([{ id: 'd', url: PRIZE, attempts: 0 }]));
    db.setTable('Prize', { error: { message: 'prize read failed' } });
    await expect(queue.processDueMediaDeletions(NOW)).rejects.toEqual({ message: 'prize read failed' });
    expect(db.storage.remove).not.toHaveBeenCalled();
  });

  it('runs at most every 15 minutes per process', async () => {
    db.setTable('MediaDeletion', { data: [] });
    expect(await queue.runMediaCleanupIfDue(NOW)).toEqual({ deleted: [], kept: [], failed: [] });
    expect(await queue.runMediaCleanupIfDue(NOW + 14 * 60 * 1000)).toBeNull();
    expect(await queue.runMediaCleanupIfDue(NOW + 15 * 60 * 1000)).not.toBeNull();
    queue.resetMediaCleanupSchedule();
    expect(await queue.runMediaCleanupIfDue()).not.toBeNull();
  });
});
