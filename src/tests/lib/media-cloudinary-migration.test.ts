// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

const storeImage = vi.fn();
const deleteStoredImage = vi.fn();
vi.mock('@/lib/media/storage.server', () => ({
  storeImage: (...a: unknown[]) => storeImage(...a),
  deleteStoredImage: (...a: unknown[]) => deleteStoredImage(...a),
}));

const {
  migratePrizeImagesFromCloudinary,
  migrateUserAvatarsFromCloudinary,
  migrateCloudinaryLibraryToSupabase,
  getPrimaryStorageProvider,
  setPrimaryStorageProvider,
  getCloudinaryPendingStats,
  migrateAllCloudinaryAssetsToSupabase,
} = await import('@/lib/media/cloudinary-migration');

const CLOUD = 'https://res.cloudinary.com/dszrz6s6u/image/upload/t_1Think2win/f_auto/q_auto';
const NEW = 'https://proj.supabase.co/storage/v1/object/public/prize-images/prizes/n-1280.webp';
let db: SupabaseMock;
const isUpdate = (call: { ops: { op: string }[] }) => call.ops.some((o) => o.op === 'update');
const prizes = [
  { id: 'p1', name: 'Honda CD70', imageUrl: `${CLOUD}/Honda_CD70_tqpzdr.jpg` },
  { id: 'p2', name: 'Local', imageUrl: '/bike.svg' },
  { id: 'p3', name: 'No image', imageUrl: null },
  { id: 'p4', name: 'Ronin', imageUrl: `${CLOUD}/Ronin_540_intluk_c17c0f.jpg` },
];

beforeEach(() => {
  db = createSupabaseMock();
  db.setTable('Prize', (call) => (isUpdate(call) ? { data: [{ id: eqValue(call, 'id') }] } : { data: prizes }));
  storeImage.mockReset().mockResolvedValue({ url: NEW, paths: [], bytes: 1 });
  deleteStoredImage.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

const image = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });

describe('migratePrizeImagesFromCloudinary', () => {
  it('dry run lists only Cloudinary prize images and changes nothing', async () => {
    const fetchImpl = vi.fn();
    expect(await migratePrizeImagesFromCloudinary(db.client as never, { apply: false, fetchImpl })).toEqual([
      { prizeId: 'p1', name: 'Honda CD70', from: prizes[0].imageUrl },
      { prizeId: 'p4', name: 'Ronin', from: prizes[3].imageUrl },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storeImage).not.toHaveBeenCalled();
    expect(db.callsTo('Prize', 'update')).toHaveLength(0);
  });

  it('copies each image as shown and points the prize at it, only if the prize still has the old URL', async () => {
    const fetchImpl = vi.fn(async () => image());
    const moves = await migratePrizeImagesFromCloudinary(db.client as never, { apply: true, fetchImpl: fetchImpl as never });
    expect(moves).toEqual([
      { prizeId: 'p1', name: 'Honda CD70', from: prizes[0].imageUrl, to: NEW },
      { prizeId: 'p4', name: 'Ronin', from: prizes[3].imageUrl, to: NEW },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(prizes[0].imageUrl);
    expect(storeImage).toHaveBeenCalledWith(db.client, 'prize-images', 'prizes', Buffer.from([1, 2, 3]));
    const update = db.callsTo('Prize', 'update')[0];
    expect(argOf(update, 'update')).toMatchObject({ imageUrl: NEW });
    expect(update.ops.filter((o) => o.op === 'eq').map((o) => o.args)).toEqual([['id', 'p1'], ['imageUrl', prizes[0].imageUrl]]);
    expect(deleteStoredImage).not.toHaveBeenCalled();
  });

  it('records failures per prize and removes a copy the prize did not take', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('gone', { status: 404 }))
      .mockImplementation(async () => image());
    db.setTable('Prize', (call) => (isUpdate(call) ? { data: [] } : { data: prizes }));
    const moves = await migratePrizeImagesFromCloudinary(db.client as never, { apply: true, fetchImpl });
    expect(moves.map((m) => m.error)).toEqual(['Cloudinary answered 404', 'The prize image was changed meanwhile, so it was left alone']);
    expect(deleteStoredImage).toHaveBeenCalledWith(db.client, NEW);

    // Update errors are reported as-is; a failing clean-up doesn't hide them
    db.setTable('Prize', (call) => (isUpdate(call) ? { error: { message: 'permission denied' } } : { data: [prizes[0]] }));
    deleteStoredImage.mockRejectedValueOnce(new Error('storage'));
    expect((await migratePrizeImagesFromCloudinary(db.client as never, { apply: true, fetchImpl }))[0].error).toBe('permission denied');
    db.setTable('Prize', (call) => (isUpdate(call) ? { data: null } : { data: [prizes[0]] }));
    expect((await migratePrizeImagesFromCloudinary(db.client as never, { apply: true, fetchImpl }))[0].error).toMatch(/changed meanwhile/);
    storeImage.mockRejectedValueOnce('odd failure');
    expect((await migratePrizeImagesFromCloudinary(db.client as never, { apply: true, fetchImpl }))[0].error).toBe('odd failure');
  });

  it('uses the global fetch by default and fails fast when prizes cannot be read', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => image());
    db.setTable('Prize', (call) => (isUpdate(call) ? { data: [{ id: 'p1' }] } : { data: [prizes[0]] }));
    expect((await migratePrizeImagesFromCloudinary(db.client as never, { apply: true }))[0].to).toBe(NEW);
    expect(fetchSpy).toHaveBeenCalledWith(prizes[0].imageUrl);
    fetchSpy.mockRestore();

    db.setTable('Prize', { data: null });
    expect(await migratePrizeImagesFromCloudinary(db.client as never, { apply: false })).toEqual([]);
    db.setTable('Prize', { error: { message: 'no table' } });
    await expect(migratePrizeImagesFromCloudinary(db.client as never, { apply: false })).rejects.toEqual({ message: 'no table' });
  });
});

describe('migrateUserAvatarsFromCloudinary', () => {
  const users = [
    { id: 'u1', name: 'Alice', email: 'alice@test.com', profilePicture: `${CLOUD}/avatar1.jpg` },
    { id: 'u2', name: 'Bob', email: 'bob@test.com', profilePicture: null },
    { id: 'u3', name: 'Charlie', email: 'charlie@test.com', profilePicture: 'https://proj.supabase.co/storage/v1/object/public/avatars/u3/a.webp' },
  ];

  it('dry run finds only users with Cloudinary profile pictures', async () => {
    db.setTable('User', { data: users });
    const fetchImpl = vi.fn();
    const moves = await migrateUserAvatarsFromCloudinary(db.client as never, { apply: false, fetchImpl });
    expect(moves).toEqual([{ userId: 'u1', name: 'Alice', from: users[0].profilePicture }]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storeImage).not.toHaveBeenCalled();
  });

  it('copies avatar into Supabase storage and updates user profile', async () => {
    db.setTable('User', (call) => (isUpdate(call) ? { data: [{ id: eqValue(call, 'id') }] } : { data: users }));
    const fetchImpl = vi.fn(async () => image());
    const moves = await migrateUserAvatarsFromCloudinary(db.client as never, { apply: true, fetchImpl: fetchImpl as never });
    expect(moves).toEqual([{ userId: 'u1', name: 'Alice', from: users[0].profilePicture, to: NEW }]);
    expect(fetchImpl).toHaveBeenCalledWith(users[0].profilePicture);
    expect(storeImage).toHaveBeenCalledWith(db.client, 'avatars', 'u1', Buffer.from([1, 2, 3]));
  });
});

describe('migrateCloudinaryLibraryToSupabase', () => {
  it('copies provided Cloudinary library resources into site-media', async () => {
    const fetchImpl = vi.fn(async () => image());
    const resources = [
      { public_id: 'banner1', secure_url: `${CLOUD}/banner1.png`, format: 'png', bytes: 1024 },
    ];
    const moves = await migrateCloudinaryLibraryToSupabase(db.client as never, {
      apply: true,
      fetchImpl: fetchImpl as never,
      resources,
    });
    expect(moves).toEqual([
      { publicId: 'banner1', from: `${CLOUD}/banner1.png`, to: NEW, format: 'png', bytes: 1024 },
    ]);
    expect(storeImage).toHaveBeenCalledWith(db.client, 'site-media', 'uploads', Buffer.from([1, 2, 3]));
  });
});

describe('getPrimaryStorageProvider and setPrimaryStorageProvider', () => {
  it('defaults to supabase when no setting exists', async () => {
    db.setTable('AppSettings', { data: null });
    expect(await getPrimaryStorageProvider(db.client as never)).toBe('supabase');
  });

  it('reads cloudinary when configured in AppSettings', async () => {
    db.setTable('AppSettings', { data: { value: 'cloudinary' } });
    expect(await getPrimaryStorageProvider(db.client as never)).toBe('cloudinary');
  });

  it('saves primary storage provider to AppSettings', async () => {
    db.setTable('AppSettings', { data: null });
    await setPrimaryStorageProvider(db.client as never, 'supabase', 'admin@example.com');
    const upsert = db.callsTo('AppSettings', 'upsert')[0];
    expect(argOf(upsert, 'upsert')).toMatchObject({
      key: 'primary_storage_provider',
      value: 'supabase',
      updatedBy: 'admin@example.com',
    });
  });
});

describe('getCloudinaryPendingStats', () => {
  it('counts prizes and avatars that still reference Cloudinary', async () => {
    db.setTable('Prize', { data: prizes });
    db.setTable('User', {
      data: [
        { profilePicture: `${CLOUD}/avatar1.jpg` },
        { profilePicture: 'https://other.com/a.jpg' },
      ],
    });
    const stats = await getCloudinaryPendingStats(db.client as never, 3);
    expect(stats).toEqual({
      prizes: 2,
      avatars: 1,
      library: 3,
      total: 6,
    });
  });
});

describe('migrateAllCloudinaryAssetsToSupabase', () => {
  it('runs full migration across prizes, avatars, and library, then sets supabase primary', async () => {
    db.setTable('Prize', (call) => (isUpdate(call) ? { data: [{ id: eqValue(call, 'id') }] } : { data: prizes }));
    db.setTable('User', (call) => (isUpdate(call) ? { data: [{ id: eqValue(call, 'id') }] } : { data: [{ id: 'u1', name: 'User 1', email: 'u1@test.com', profilePicture: `${CLOUD}/avatar.jpg` }] }));
    db.setTable('AppSettings', { data: null });

    const fetchImpl = vi.fn(async () => image());
    const resources = [{ public_id: 'logo', secure_url: `${CLOUD}/logo.png`, format: 'png', bytes: 500 }];

    const result = await migrateAllCloudinaryAssetsToSupabase(db.client as never, 'admin@test.com', {
      fetchImpl: fetchImpl as never,
      resources,
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('supabase');
    expect(result.prizesMigrated).toBe(2);
    expect(result.avatarsMigrated).toBe(1);
    expect(result.libraryMigrated).toBe(1);
    expect(result.totalMigrated).toBe(4);
    expect(result.totalFailed).toBe(0);
    expect(result.message).toContain('Successfully moved 4 asset(s) to Supabase Storage');
  });
});
