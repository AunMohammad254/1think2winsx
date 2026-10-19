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
    { id: 'u2', name: null, email: 'bob@test.com', profilePicture: `${CLOUD}/avatar2.jpg` },
    { id: 'u3', name: null, email: null, profilePicture: `${CLOUD}/avatar3.jpg` },
    // The LIKE filter is a prefix match; another account's Cloudinary link is still left alone
    { id: 'u4', name: 'Dan', email: null, profilePicture: 'https://res.cloudinary.com/other/image/upload/a.jpg' },
  ];

  it('dry run lists Cloudinary profile pictures, named by name, then email, then id', async () => {
    db.setTable('User', { data: users });
    const fetchImpl = vi.fn();
    const moves = await migrateUserAvatarsFromCloudinary(db.client as never, { apply: false, fetchImpl });
    expect(moves).toEqual([
      { userId: 'u1', name: 'Alice', from: users[0].profilePicture },
      { userId: 'u2', name: 'bob@test.com', from: users[1].profilePicture },
      { userId: 'u3', name: 'u3', from: users[2].profilePicture },
    ]);
    // Only Cloudinary rows are read, so the 1,000-row API cap can't hide any
    expect(db.callsTo('User')[0].ops).toContainEqual({ op: 'like', args: ['profilePicture', 'https://res.cloudinary.com/%'] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storeImage).not.toHaveBeenCalled();
  });

  it("copies each picture into the player's avatars folder and points the profile at it", async () => {
    db.setTable('User', (call) => (isUpdate(call) ? { data: [{ id: eqValue(call, 'id') }] } : { data: [users[0]] }));
    const fetchImpl = vi.fn(async () => image());
    const moves = await migrateUserAvatarsFromCloudinary(db.client as never, { apply: true, fetchImpl: fetchImpl as never });
    expect(moves).toEqual([{ userId: 'u1', name: 'Alice', from: users[0].profilePicture, to: NEW }]);
    expect(fetchImpl).toHaveBeenCalledWith(users[0].profilePicture);
    expect(storeImage).toHaveBeenCalledWith(db.client, 'avatars', 'u1', Buffer.from([1, 2, 3]));
    const update = db.callsTo('User', 'update')[0];
    expect(argOf(update, 'update')).toMatchObject({ profilePicture: NEW });
    expect(update.ops.filter((o) => o.op === 'eq').map((o) => o.args)).toEqual([['id', 'u1'], ['profilePicture', users[0].profilePicture]]);
  });

  it('records a picture changed meanwhile, and fails fast when players cannot be read', async () => {
    db.setTable('User', (call) => (isUpdate(call) ? { data: [] } : { data: [users[0]] }));
    const moves = await migrateUserAvatarsFromCloudinary(db.client as never, { apply: true, fetchImpl: vi.fn(async () => image()) });
    expect(moves[0].error).toBe('The profile picture was changed meanwhile, so it was left alone');
    expect(deleteStoredImage).toHaveBeenCalledWith(db.client, NEW);

    db.setTable('User', { data: null });
    expect(await migrateUserAvatarsFromCloudinary(db.client as never, { apply: false })).toEqual([]);
    db.setTable('User', { error: { message: 'no table' } });
    await expect(migrateUserAvatarsFromCloudinary(db.client as never, { apply: false })).rejects.toEqual({ message: 'no table' });
  });
});

describe('getCloudinaryPendingStats', () => {
  it('counts prize images and profile pictures still on Cloudinary, without copying anything', async () => {
    db.setTable('User', { data: [{ id: 'u1', name: 'A', email: null, profilePicture: `${CLOUD}/avatar1.jpg` }] });
    expect(await getCloudinaryPendingStats(db.client as never)).toEqual({ prizes: 2, avatars: 1, total: 3 });
    expect(storeImage).not.toHaveBeenCalled();
  });
});

describe('migrateAllCloudinaryAssetsToSupabase', () => {
  const avatar = { id: 'u1', name: 'User 1', email: 'u1@test.com', profilePicture: `${CLOUD}/avatar.jpg` };

  it('moves prize images and profile pictures and sums them up', async () => {
    db.setTable('User', (call) => (isUpdate(call) ? { data: [{ id: 'u1' }] } : { data: [avatar] }));
    const fetchImpl = vi.fn(async () => image());
    const result = await migrateAllCloudinaryAssetsToSupabase(db.client as never, { fetchImpl: fetchImpl as never });
    expect(result).toMatchObject({
      prizesMigrated: 2,
      prizesFailed: 0,
      avatarsMigrated: 1,
      avatarsFailed: 0,
      totalMigrated: 3,
      totalFailed: 0,
      message: 'Moved 3 image(s) to Supabase Storage.',
    });
    expect(result.details.avatars).toHaveLength(1);
  });

  it('reports what could not be moved, and when there is nothing to move', async () => {
    db.setTable('User', { data: [avatar] });
    const fetchImpl = vi.fn(async () => new Response('gone', { status: 404 }));
    const failed = await migrateAllCloudinaryAssetsToSupabase(db.client as never, { fetchImpl: fetchImpl as never });
    expect(failed).toMatchObject({ totalMigrated: 0, totalFailed: 3, prizesFailed: 2, avatarsFailed: 1 });
    expect(failed.message).toBe('Moved 0 image(s); 3 could not be moved and still load from Cloudinary.');

    db.setTable('Prize', { data: [] });
    db.setTable('User', { data: [] });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const none = await migrateAllCloudinaryAssetsToSupabase(db.client as never);
    expect(none.message).toBe('Nothing to move: no prize image or profile picture loads from Cloudinary.');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
