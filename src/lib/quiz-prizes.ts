import { getAdminDb } from '@/lib/supabase/db';

/**
 * Prizes a player won in a quiz, and their delivery claims (migration 20261024190000_quiz_prize_claims).
 * Settlement takes the prize out of stock; the winner then sends their delivery details, which makes a
 * pending claim ("PrizeRedemption", 0 points) that admins handle on the Claims screen. Server-only:
 * players can't read "QuizWinner".
 */

export type QuizPrizeClaimStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled';

export interface QuizPrizeClaim {
  id: string;
  status: QuizPrizeClaimStatus;
  requestedAt: string;
  processedAt: string | null;
  /** The admin's note on a decision (a rejection says why) */
  notes: string | null;
}

export interface QuizPrize {
  winnerId: string;
  quizId: string;
  quizTitle: string;
  rank: number;
  wonAt: string;
  prize: { id: string; name: string; imageUrl: string | null; type: string; category: string };
  /** null until the winner sends their delivery details */
  claim: QuizPrizeClaim | null;
}

export interface DeliveryDetails { fullName: string; whatsappNumber: string; address: string }

export type ClaimQuizPrizeResult =
  | { ok: true; claimId: string }
  | { ok: false; status: number; code: string; error: string };

type Joined<T> = T | T[] | null;
const one = <T>(value: Joined<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value);

interface WinRow {
  id: string;
  quizId: string;
  rank: number;
  selectedAt: string;
  Quiz: Joined<{ title: string }>;
  Prize: Joined<QuizPrize['prize']>;
  PrizeRedemption: Joined<QuizPrizeClaim>;
}

/** The player's prizes won in quizzes, newest first (places paid in points are left out). */
export async function listQuizPrizes(userId: string): Promise<QuizPrize[]> {
  const { data, error } = await getAdminDb()
    .from('QuizWinner')
    .select(`
      id, quizId, rank, selectedAt,
      Quiz:quizId (title),
      Prize:prizeId (id, name, imageUrl, type, category),
      PrizeRedemption:prizeRedemptionId (id, status, requestedAt, processedAt, notes)
    `)
    .eq('userId', userId)
    .not('prizeId', 'is', null)
    .order('selectedAt', { ascending: false });
  if (error) throw error;

  return ((data || []) as unknown as WinRow[]).flatMap((row) => {
    const prize = one(row.Prize);
    // The prize can't be deleted while a winner row points to it, but the join may still come back empty
    if (!prize) return [];
    return [{
      winnerId: row.id,
      quizId: row.quizId,
      quizTitle: one(row.Quiz)?.title ?? 'Quiz',
      rank: row.rank,
      wonAt: row.selectedAt,
      prize,
      claim: one(row.PrizeRedemption),
    }];
  });
}

const CLAIM_STATUS: Record<string, number> = { invalid: 400, not_found: 404, already_claimed: 409, out_of_stock: 409 };

/** Send the winner's delivery details: a pending claim linked to the win. A refusal comes back with an HTTP status. */
export async function claimQuizPrize(winnerId: string, userId: string, details: DeliveryDetails): Promise<ClaimQuizPrizeResult> {
  const { data, error } = await getAdminDb().rpc('claim_quiz_prize', {
    p_winner_id: winnerId,
    p_user_id: userId,
    p_full_name: details.fullName,
    p_whatsapp_number: details.whatsappNumber,
    p_address: details.address,
  });
  if (error) throw error;
  const result = data as { success: boolean; claimId?: string; code?: string; error?: string };
  if (result.success) return { ok: true, claimId: result.claimId as string };
  return {
    ok: false,
    status: CLAIM_STATUS[result.code ?? ''] ?? 500,
    code: result.code ?? 'error',
    error: result.error ?? 'Could not save your delivery details',
  };
}
