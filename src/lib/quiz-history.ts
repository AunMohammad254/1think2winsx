import { getAdminDb } from '@/lib/supabase/db';

/**
 * A settled quiz's rows are its payout history: who won which place, the prize or points paid, and the
 * pool shares. They all cascade with the quiz, while the points stay in "User".points, so deleting a
 * settled quiz would leave paid points with no record of why. Admins pause such a quiz instead; a quiz
 * that was never settled (a test, or one abandoned before its result) can still be deleted.
 */
export const SETTLED_QUIZ_DELETE_ERROR =
  'This quiz has been settled: deleting it would erase who won and what was paid. Pause it instead.';

/**
 * A settled quiz's questions are closed and its rewards paid, so it never goes live again: a push would
 * send every user a "Live now" notice for a quiz nobody can answer. Reuse Quiz makes a fresh copy.
 */
export const SETTLED_QUIZ_LIVE_ERROR =
  "This quiz has been settled, so it can't go live again. Use Reuse Quiz to run a copy.";

/** True when the quiz has a settlement, or winners recorded before settlements existed. */
export async function hasPayoutHistory(quizId: string): Promise<boolean> {
  const db = getAdminDb();
  const [settlement, winners] = await Promise.all([
    db.from('QuizSettlement').select('quizId', { count: 'exact', head: true }).eq('quizId', quizId),
    db.from('QuizWinner').select('id', { count: 'exact', head: true }).eq('quizId', quizId),
  ]);
  // A failed lookup stops the delete: it is never assumed that there is nothing to lose
  if (settlement.error) throw settlement.error;
  if (winners.error) throw winners.error;
  return (settlement.count ?? 0) > 0 || (winners.count ?? 0) > 0;
}
