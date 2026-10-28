// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));

const { listQuizPrizes, claimQuizPrize } = await import('@/lib/quiz-prizes');

beforeEach(() => {
  adminDb = createSupabaseMock();
});

const WATCH = { id: 'p1', name: 'Smartwatch', imageUrl: null, type: 'gadget', category: 'electronics' };
const DETAILS = { fullName: 'Ali Raza', whatsappNumber: '+92 300 1234567', address: 'House 12, Street 4, Lahore' };

describe('listQuizPrizes', () => {
  it("lists the player's prizes won in quizzes with their claim, whichever shape the joins come in", async () => {
    adminDb.setTable('QuizWinner', {
      data: [
        { id: 'w1', quizId: 'q1', rank: 1, selectedAt: '2026-10-20', Quiz: { title: 'Final' }, Prize: WATCH, PrizeRedemption: null },
        {
          id: 'w2', quizId: 'q2', rank: 2, selectedAt: '2026-10-10', Quiz: [{ title: 'Semi' }], Prize: [WATCH],
          PrizeRedemption: [{ id: 'c1', trackingId: '1T2W-7K3M-QX97', status: 'rejected', requestedAt: '2026-10-11', processedAt: '2026-10-12', notes: 'Wrong address', handoverVersion: 1 }],
        },
        { id: 'w3', quizId: 'q3', rank: 3, selectedAt: '2026-10-05', Quiz: null, Prize: WATCH, PrizeRedemption: [] },
        { id: 'gone', quizId: 'q4', rank: 1, selectedAt: '2026-10-01', Quiz: null, Prize: null, PrizeRedemption: null },
      ],
    });
    adminDb.setTable('PrizeClaimEvent', { data: [
      { claimId: 'c1', event: 'submitted', note: null, createdAt: '2026-10-11T09:00:00Z' },
      { claimId: 'c1', event: 'rejected', note: 'Wrong address', createdAt: '2026-10-12T09:00:00Z' },
    ] });
    expect(await listQuizPrizes('user-1')).toEqual([
      { winnerId: 'w1', quizId: 'q1', quizTitle: 'Final', rank: 1, wonAt: '2026-10-20', prize: WATCH, claim: null },
      {
        winnerId: 'w2', quizId: 'q2', quizTitle: 'Semi', rank: 2, wonAt: '2026-10-10', prize: WATCH,
        claim: {
          id: 'c1', trackingId: '1T2W-7K3M-QX97', status: 'rejected', requestedAt: '2026-10-11', processedAt: '2026-10-12', notes: 'Wrong address',
          handoverCode: null,
          timeline: [{ event: 'submitted', at: '2026-10-11T09:00:00Z' }, { event: 'rejected', at: '2026-10-12T09:00:00Z', note: 'Wrong address' }],
        },
      },
      { winnerId: 'w3', quizId: 'q3', quizTitle: 'Quiz', rank: 3, wonAt: '2026-10-05', prize: WATCH, claim: null },
    ]);
    const call = adminDb.callsTo('QuizWinner')[0];
    expect(eqValue(call, 'userId')).toBe('user-1');
    // Places paid in points have nothing to deliver
    expect(call.ops.find((o) => o.op === 'not')?.args).toEqual(['prizeId', 'is', null]);
  });

  it('shows the handover code only while the claim is approved, and still lists prizes when the timeline fails', async () => {
    vi.stubEnv('CLAIM_HANDOVER_SECRET', 'test-handover-secret');
    const claim = { id: 'c1', trackingId: '1T2W-7K3M-QX97', status: 'approved', requestedAt: '2026-10-11', processedAt: '2026-10-12', notes: null, handoverVersion: 3 };
    adminDb.setTable('QuizWinner', { data: [{ id: 'w1', quizId: 'q1', rank: 1, selectedAt: '2026-10-20', Quiz: { title: 'Final' }, Prize: WATCH, PrizeRedemption: claim }] });
    adminDb.setTable('PrizeClaimEvent', { error: { message: 'relation "PrizeClaimEvent" does not exist' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const [prize] = await listQuizPrizes('user-1');
    const { handoverCode } = await import('@/lib/claim-tracking');
    expect(prize.claim).toEqual({ ...claim, handoverVersion: undefined, handoverCode: handoverCode('c1', 3), timeline: [] });
    expect(prize.claim).not.toHaveProperty('handoverVersion');
    vi.unstubAllEnvs();
  });

  it('copes with no rows, and throws a failed read', async () => {
    adminDb.setTable('QuizWinner', { data: null });
    expect(await listQuizPrizes('user-1')).toEqual([]);
    adminDb.setTable('QuizWinner', { error: { message: 'down' } });
    await expect(listQuizPrizes('user-1')).rejects.toEqual({ message: 'down' });
  });
});

describe('claimQuizPrize', () => {
  it('passes the win, the player and the details to claim_quiz_prize', async () => {
    adminDb.setRpc('claim_quiz_prize', { data: { success: true, claimId: 'pr_1' } });
    expect(await claimQuizPrize('w1', 'user-1', DETAILS)).toEqual({ ok: true, claimId: 'pr_1' });
    expect(adminDb.rpcCalls).toEqual([{
      fn: 'claim_quiz_prize',
      args: { p_winner_id: 'w1', p_user_id: 'user-1', p_full_name: 'Ali Raza', p_whatsapp_number: '+92 300 1234567', p_address: 'House 12, Street 4, Lahore' },
    }]);
  });

  it.each([
    ['invalid', 400],
    ['not_found', 404],
    ['already_claimed', 409],
    ['out_of_stock', 409],
    ['something_new', 500],
  ])('maps the refusal %s to HTTP %i', async (code, status) => {
    adminDb.setRpc('claim_quiz_prize', { data: { success: false, code, error: 'Nope' } });
    expect(await claimQuizPrize('w1', 'user-1', DETAILS)).toEqual({ ok: false, status, code, error: 'Nope' });
  });

  it('fills in a refusal without code or message, and throws a database error', async () => {
    adminDb.setRpc('claim_quiz_prize', { data: { success: false } });
    expect(await claimQuizPrize('w1', 'user-1', DETAILS)).toEqual({ ok: false, status: 500, code: 'error', error: 'Could not save your delivery details' });
    adminDb.setRpc('claim_quiz_prize', { error: { message: 'timeout' } });
    await expect(claimQuizPrize('w1', 'user-1', DETAILS)).rejects.toEqual({ message: 'timeout' });
  });
});
