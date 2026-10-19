// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
let adminDb: SupabaseMock;
const adminActionGuard = vi.fn();
const revalidatePath = vi.fn();
const schedulePrizeImageDeletion = vi.fn();
const prizeDb = { findById: vi.fn(), findByIdAdmin: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };

vi.mock('@/lib/supabase/db', () => ({ getDb: async () => db.client, getAdminDb: () => adminDb.client, prizeDb }));
vi.mock('@/lib/admin-guard', () => ({ adminActionGuard: (...a: unknown[]) => adminActionGuard(...a) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/lib/media/deletion-queue', () => ({ schedulePrizeImageDeletion: (...a: unknown[]) => schedulePrizeImageDeletion(...a) }));

const actions = await import('@/actions/prizes');

const CLOUD = 'https://res.cloudinary.com/dszrz6s6u/image/upload';
const DENIED = { success: false, error: 'Unauthorized: admin session required' };
const form = { prizeId: 'prize-1', fullName: 'Ali Khan', whatsappNumber: '03001234567', address: 'House 1, Street 2, Lahore' };
const prize = (over: Record<string, unknown> = {}) => ({ id: 'prize-1', name: 'Phone', imageUrl: `${CLOUD}/v1/prizes/phone.jpg`, isActive: true, status: 'published', isClaimed: false, ...over });

beforeEach(() => {
  db = createSupabaseMock({ user: { id: 'user-1', email: 'p@example.test' } });
  adminDb = createSupabaseMock();
  for (const fn of [adminActionGuard, revalidatePath, schedulePrizeImageDeletion, ...Object.values(prizeDb)]) fn.mockReset();
  adminActionGuard.mockResolvedValue(null);
  schedulePrizeImageDeletion.mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getPublicPrizes', () => {
  it.each([
    ['points-asc', 'pointsRequired', true],
    ['points-desc', 'pointsRequired', false],
    ['newest', 'createdAt', false],
    ['oldest', 'createdAt', true],
    ['name-asc', 'name', true],
  ] as const)('sorts by %s', async (sortBy, column, ascending) => {
    db.setTable('Prize', { data: [prize()] });
    const res = await actions.getPublicPrizes('all', sortBy);
    expect(res).toEqual({ success: true, data: [prize()] });
    const call = db.callsTo('Prize')[0];
    expect(call.ops.find((o) => o.op === 'order')?.args).toEqual([column, { ascending }]);
    expect(eqValue(call, 'status')).toBe('published');
    expect(eqValue(call, 'category')).toBeUndefined();
  });

  it('filters by category and uses the defaults', async () => {
    db.setTable('Prize', { data: [] });
    await actions.getPublicPrizes('electronics');
    expect(eqValue(db.callsTo('Prize')[0], 'category')).toBe('electronics');
    await actions.getPublicPrizes();
    expect(argOf(db.callsTo('Prize')[1], 'order')).toBe('pointsRequired');
  });

  it('reports a failed query', async () => {
    db.setTable('Prize', { error: { message: 'x' } });
    expect(await actions.getPublicPrizes()).toEqual({ success: false, error: 'Failed to fetch prizes' });
  });

  it("marks prizes the signed-in player already claimed or won", async () => {
    db.setTable('Prize', { data: [prize(), prize({ id: 'prize-2' }), prize({ id: 'prize-3' })] });
    db.setTable('PrizeRedemption', { data: [{ prizeId: 'prize-1' }, {}] });
    db.setTable('Winning', { data: [{ prizeId: 'prize-3' }, { prizeId: null }] });
    const res = await actions.getPublicPrizes();
    expect(res.data?.map((p) => [p.id, p.isClaimed])).toEqual([['prize-1', true], ['prize-2', false], ['prize-3', true]]);
    const redemptions = db.callsTo('PrizeRedemption')[0];
    expect(eqValue(redemptions, 'userId')).toBe('user-1');
    expect(redemptions.ops.find((o) => o.op === 'in')?.args).toEqual(['status', ['pending', 'approved', 'fulfilled']]);
    expect(eqValue(db.callsTo('Winning')[0], 'userId')).toBe('user-1');

    // Nothing found, or no rows at all
    db.setTable('PrizeRedemption', { data: null });
    db.setTable('Winning', { data: null });
    expect((await actions.getPublicPrizes()).success).toBe(true);
    db.setTable('Prize', { data: null });
    expect(await actions.getPublicPrizes()).toEqual({ success: true, data: [] });
  });

  it('lists prizes for guests, and when the session check fails, with nothing claimed', async () => {
    db.setTable('Prize', { data: [prize()] });
    db.setUser(null);
    expect(await actions.getPublicPrizes()).toEqual({ success: true, data: [prize()] });
    expect(db.callsTo('PrizeRedemption')).toHaveLength(0);
    db.auth.getClaims.mockRejectedValueOnce(new Error('auth down'));
    expect(await actions.getPublicPrizes()).toEqual({ success: true, data: [prize()] });
  });
});

describe('redeemPrize', () => {
  it('ignores the client-supplied user id and redeems for the session user', async () => {
    prizeDb.findById.mockResolvedValue(prize());
    db.setRpc('redeem_prize', { data: { success: true, redemption_id: 'red-1', points_used: 500 } });

    const res = await actions.redeemPrize('someone-else', form);

    expect(res).toEqual({
      success: true,
      data: { id: 'red-1', userId: 'user-1', prizeId: 'prize-1', pointsUsed: 500, status: 'pending', prize: { name: 'Phone', imageUrl: prize().imageUrl } },
    });
    expect(db.rpcCalls[0].args).toEqual({ p_user_id: 'user-1', p_prize_id: 'prize-1', p_full_name: 'Ali Khan', p_whatsapp_number: '03001234567', p_address: 'House 1, Street 2, Lahore' });
    expect(revalidatePath).toHaveBeenCalledWith('/prizes');
    expect(revalidatePath).toHaveBeenCalledWith('/profile');
  });

  it('validates the form and requires a session', async () => {
    expect(await actions.redeemPrize('', { ...form, address: 'short' })).toEqual({ success: false, error: 'Complete address is required' });
    db.setUser(null);
    expect(await actions.redeemPrize('', form)).toEqual({ success: false, error: 'You must be logged in to redeem prizes' });
  });

  it('refuses duplicate claims and unavailable prizes', async () => {
    // redeem_prize refuses a prize the player has already claimed (checked under a lock in the database)
    const already = 'You have already claimed this prize. Each prize can only be claimed once per account.';
    prizeDb.findById.mockResolvedValueOnce(prize());
    db.setRpc('redeem_prize', { data: { success: false, code: 'already_claimed', error: already } });
    expect(await actions.redeemPrize('', form)).toEqual({ success: false, error: already });
    db.rpcCalls.length = 0;

    for (const p of [null, prize({ isActive: false }), prize({ status: 'draft' })]) {
      prizeDb.findById.mockResolvedValueOnce(p);
      expect((await actions.redeemPrize('', form)).error).toBe('This prize is no longer available');
    }
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('explains an insufficient balance and other refusals', async () => {
    prizeDb.findById.mockResolvedValue(prize());
    db.setRpc('redeem_prize', { data: { success: false, error: 'Insufficient points', required: 500, available: 20 } });
    expect((await actions.redeemPrize('', form)).error).toBe('Insufficient points. You need 500 points but have 20');
    db.setRpc('redeem_prize', { data: { success: false, error: 'Out of stock' } });
    expect((await actions.redeemPrize('', form)).error).toBe('Out of stock');
    db.setRpc('redeem_prize', { error: { message: 'down' } });
    expect((await actions.redeemPrize('', form)).error).toBe('Failed to process redemption');
  });

  it('turns exceptions into a generic error', async () => {
    prizeDb.findById.mockRejectedValue(new Error('db'));
    expect(await actions.redeemPrize('', form)).toEqual({ success: false, error: 'Failed to process redemption' });
  });
});

describe('admin prize actions', () => {
  it('all refuse without an admin session', async () => {
    adminActionGuard.mockResolvedValue(DENIED);
    expect(await actions.getAllPrizesAdmin()).toEqual(DENIED);
    expect(await actions.createPrize({} as never)).toEqual(DENIED);
    expect(await actions.updatePrize('p', {})).toEqual(DENIED);
    expect(await actions.deletePrize('p')).toEqual(DENIED);
    expect(await actions.togglePrizeStatus('p')).toEqual(DENIED);
    expect(await actions.togglePrizeActive('p')).toEqual(DENIED);
    expect(prizeDb.findByIdAdmin).not.toHaveBeenCalled();
    expect(adminDb.calls).toHaveLength(0);
  });

  it('getAllPrizesAdmin applies filters and adds redemption/winning counts', async () => {
    adminDb.setTable('Prize', { data: [{ id: 'a' }, { id: 'b' }] });
    adminDb.setTable('PrizeRedemption', (call) => ({ count: eqValue(call, 'prizeId') === 'a' ? 3 : null }));
    adminDb.setTable('Winning', (call) => ({ count: eqValue(call, 'prizeId') === 'a' ? 1 : null }));

    const res = await actions.getAllPrizesAdmin({ category: 'vehicles', status: 'draft', search: 'bike' });

    expect(res.data).toEqual([
      { id: 'a', _count: { redemptions: 3, winnings: 1 } },
      { id: 'b', _count: { redemptions: 0, winnings: 0 } },
    ]);
    const query = adminDb.callsTo('Prize')[0];
    expect(eqValue(query, 'category')).toBe('vehicles');
    expect(eqValue(query, 'status')).toBe('draft');
    expect(argOf(query, 'or')).toBe('name.ilike.%bike%,description.ilike.%bike%');
  });

  it('getAllPrizesAdmin skips "all" filters and handles errors', async () => {
    adminDb.setTable('Prize', { data: null });
    expect(await actions.getAllPrizesAdmin({ category: 'all', status: 'all' })).toEqual({ success: true, data: [] });
    expect(eqValue(adminDb.callsTo('Prize')[0], 'category')).toBeUndefined();
    adminDb.setTable('Prize', { error: { message: 'x' } });
    expect(await actions.getAllPrizesAdmin()).toEqual({ success: false, error: 'Failed to fetch prizes' });
  });

  it('getPrizeById returns the prize with counts', async () => {
    prizeDb.findById.mockResolvedValue(prize());
    db.setTable('PrizeRedemption', { count: 2 });
    db.setTable('Winning', { count: null });
    expect(await actions.getPrizeById('prize-1')).toEqual({ success: true, data: { ...prize(), _count: { redemptions: 2, winnings: 0 } } });
    db.setTable('PrizeRedemption', { count: null });
    expect(((await actions.getPrizeById('prize-1')).data as { _count?: unknown } | undefined)?._count).toEqual({ redemptions: 0, winnings: 0 });
    prizeDb.findById.mockResolvedValue(null);
    expect(await actions.getPrizeById('nope')).toEqual({ success: false, error: 'Prize not found' });
    prizeDb.findById.mockRejectedValue(new Error('x'));
    expect(await actions.getPrizeById('x')).toEqual({ success: false, error: 'Failed to fetch prize' });
  });

  it('createPrize validates and stores defaults', async () => {
    prizeDb.create.mockResolvedValue({ id: 'new' });
    expect(await actions.createPrize({ name: 'Bike', type: 'bike', pointsRequired: 1000 } as never)).toEqual({ success: true, data: { id: 'new' } });
    expect(prizeDb.create).toHaveBeenCalledWith({
      name: 'Bike', description: null, imageUrl: null, modelUrl: null, type: 'bike', pointsRequired: 1000,
      category: 'general', stock: 0, status: 'published', value: 0, isActive: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/prizes');

    expect(await actions.createPrize({ name: 'Bike', type: 'bike', pointsRequired: 1, imageUrl: 'https://evil.example/a.png' } as never))
      .toEqual({ success: false, error: expect.stringContaining('Supabase Storage') });
    expect(await actions.createPrize({ name: 'Watch', type: 'watch', pointsRequired: 1, imageUrl: '/prizes/watch.svg' } as never)).toEqual({ success: true, data: { id: 'new' } });
    expect(prizeDb.create).toHaveBeenLastCalledWith(expect.objectContaining({ imageUrl: '/prizes/watch.svg' }));
    expect(await actions.createPrize({ name: '', type: 'bike', pointsRequired: 1 } as never)).toEqual({ success: false, error: 'Name is required' });

    prizeDb.create.mockRejectedValue(new Error('x'));
    expect(await actions.createPrize({ name: 'B', type: 't', pointsRequired: 1 } as never)).toEqual({ success: false, error: 'Failed to create prize' });
  });

  it('updatePrize writes only the provided fields', async () => {
    prizeDb.findByIdAdmin.mockResolvedValue(prize({ imageUrl: null }));
    prizeDb.update.mockResolvedValue({ id: 'prize-1' });
    await actions.updatePrize('prize-1', { name: 'New', description: '', imageUrl: '', modelUrl: '', type: 't', pointsRequired: 5, category: 'vehicles', stock: 0, status: 'draft', value: 9 });
    expect(prizeDb.update).toHaveBeenCalledWith('prize-1', {
      name: 'New', description: null, imageUrl: null, modelUrl: null, type: 't', pointsRequired: 5, category: 'vehicles', stock: 0, status: 'draft', value: 9,
    });
    expect(schedulePrizeImageDeletion).not.toHaveBeenCalled();
  });

  it('saves bumper prizes, the admin-only category the prize form offers', async () => {
    prizeDb.create.mockResolvedValue({ id: 'new' });
    expect(await actions.createPrize({ name: 'Mystery bike', type: 'bike', pointsRequired: 1, category: 'bumper' } as never))
      .toEqual({ success: true, data: { id: 'new' } });
    expect(prizeDb.create).toHaveBeenCalledWith(expect.objectContaining({ category: 'bumper' }));

    prizeDb.findByIdAdmin.mockResolvedValue(prize({ imageUrl: null }));
    prizeDb.update.mockResolvedValue({ id: 'prize-1' });
    expect((await actions.updatePrize('prize-1', { category: 'bumper' })).success).toBe(true);
    expect(prizeDb.update).toHaveBeenLastCalledWith('prize-1', { category: 'bumper' });
  });

  it('leaves the fields a partial update omits untouched, instead of resetting them to the create defaults', async () => {
    prizeDb.findByIdAdmin.mockResolvedValue(prize({ imageUrl: null }));
    prizeDb.update.mockResolvedValue({});
    await actions.updatePrize('prize-1', { name: 'Renamed' });
    expect(prizeDb.update).toHaveBeenLastCalledWith('prize-1', { name: 'Renamed' });
  });

  it('updatePrize queues the replaced image for delayed deletion instead of deleting it', async () => {
    prizeDb.findByIdAdmin.mockResolvedValue(prize());
    prizeDb.update.mockResolvedValue({});
    expect(await actions.updatePrize('prize-1', { imageUrl: `${CLOUD}/v2/prizes/new.jpg` })).toEqual({ success: true, data: {} });
    expect(schedulePrizeImageDeletion).toHaveBeenCalledWith(prize().imageUrl, 'prize_image_replaced', 'prize-1');
    // Saved first, queued after
    expect(prizeDb.update.mock.invocationCallOrder[0]).toBeLessThan(schedulePrizeImageDeletion.mock.invocationCallOrder[0]);

    // Same image, or no image field in the update: nothing to queue
    schedulePrizeImageDeletion.mockClear();
    await actions.updatePrize('prize-1', { imageUrl: prize().imageUrl });
    await actions.updatePrize('prize-1', { name: 'Renamed' });
    expect(schedulePrizeImageDeletion).not.toHaveBeenCalled();
  });

  it('a queueing failure never fails the prize update', async () => {
    prizeDb.findByIdAdmin.mockResolvedValue(prize());
    prizeDb.update.mockResolvedValue({ id: 'prize-1' });
    schedulePrizeImageDeletion.mockRejectedValue(new Error('MediaDeletion missing'));
    expect(await actions.updatePrize('prize-1', { imageUrl: '' })).toEqual({ success: true, data: { id: 'prize-1' } });
    expect(console.error).toHaveBeenCalledWith('Failed to queue old prize image for deletion:', expect.any(Error));
  });

  it('updatePrize handles a missing prize, bad input and failures', async () => {
    prizeDb.findByIdAdmin.mockResolvedValue(null);
    expect(await actions.updatePrize('x', {})).toEqual({ success: false, error: 'Prize not found' });
    prizeDb.findByIdAdmin.mockResolvedValue(prize());
    expect(await actions.updatePrize('x', { pointsRequired: 0 })).toEqual({ success: false, error: 'Points must be at least 1' });
    prizeDb.update.mockRejectedValue(new Error('x'));
    expect(await actions.updatePrize('x', { name: 'n' })).toEqual({ success: false, error: 'Failed to update prize' });
  });

  it('deletePrize refuses prizes with redemptions and cleans up the image otherwise', async () => {
    db.setTable('PrizeRedemption', { count: 4 });
    expect(await actions.deletePrize('prize-1')).toEqual({ success: false, error: 'Cannot delete prize with 4 redemptions. Deactivate instead.' });
    expect(prizeDb.delete).not.toHaveBeenCalled();

    db.setTable('PrizeRedemption', { count: 0 });
    prizeDb.findByIdAdmin.mockResolvedValue(prize());
    expect(await actions.deletePrize('prize-1')).toEqual({ success: true });
    expect(prizeDb.delete).toHaveBeenCalledWith('prize-1');
    expect(schedulePrizeImageDeletion).toHaveBeenCalledWith(prize().imageUrl, 'prize_deleted', 'prize-1');
    schedulePrizeImageDeletion.mockClear();

    prizeDb.findByIdAdmin.mockResolvedValue(null);
    expect(await actions.deletePrize('prize-2')).toEqual({ success: true });
    expect(schedulePrizeImageDeletion).not.toHaveBeenCalled();
    prizeDb.delete.mockRejectedValue(new Error('x'));
    expect(await actions.deletePrize('prize-3')).toEqual({ success: false, error: 'Failed to delete prize' });
  });

  it('toggles status and active state', async () => {
    prizeDb.update.mockImplementation(async (_id, data) => data);
    prizeDb.findByIdAdmin.mockResolvedValue(prize({ status: 'published', isActive: true }));
    expect((await actions.togglePrizeStatus('prize-1')).data).toEqual({ status: 'draft' });
    expect((await actions.togglePrizeActive('prize-1')).data).toEqual({ isActive: false });
    prizeDb.findByIdAdmin.mockResolvedValue(prize({ status: 'draft' }));
    expect((await actions.togglePrizeStatus('prize-1')).data).toEqual({ status: 'published' });

    prizeDb.findByIdAdmin.mockResolvedValue(null);
    expect(await actions.togglePrizeStatus('x')).toEqual({ success: false, error: 'Prize not found' });
    expect(await actions.togglePrizeActive('x')).toEqual({ success: false, error: 'Prize not found' });
    prizeDb.findByIdAdmin.mockRejectedValue(new Error('x'));
    expect(await actions.togglePrizeStatus('x')).toEqual({ success: false, error: 'Failed to toggle prize status' });
    expect(await actions.togglePrizeActive('x')).toEqual({ success: false, error: 'Failed to toggle prize active state' });
  });
});
