import { getAdminDb } from '@/lib/supabase/db';
import type { QuizAction, QuizActionEntry } from '@/lib/admin-action-labels';

/**
 * Who did what to a quiz, and when (F5; table "AdminActionLog", migration 20261024210000). Every admin
 * write to a quiz, its questions or its result adds a row, shown on the admin quiz page's History tab.
 * Server-only. Rows are never changed or deleted, and outlive a deleted quiz.
 */

/** Who to record for a signed-in admin: their email, or their user id when the session has none. */
export const adminName = (user: { id: string; email?: string | null }): string => user.email || user.id;

export interface QuizActionInput {
  quizId: string;
  action: QuizAction;
  adminEmail: string;
  quizTitle?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Record an admin action. Best effort: the action itself already happened, so a failed write (or a
 * database without the table yet) is reported in the server log and never fails the admin's request.
 */
export async function logQuizAction(entry: QuizActionInput): Promise<void> {
  try {
    const { error } = await getAdminDb().from('AdminActionLog').insert({
      quizId: entry.quizId,
      quizTitle: entry.quizTitle ?? null,
      action: entry.action,
      adminEmail: entry.adminEmail,
      details: entry.details ?? {},
    });
    if (error) throw error;
  } catch (error) {
    console.error(`[admin-action-log] Could not record ${entry.action} on quiz ${entry.quizId}:`, error);
  }
}

/** A quiz's actions, newest first. */
export async function listQuizActions(quizId: string, limit = 200): Promise<QuizActionEntry[]> {
  const { data, error } = await getAdminDb()
    .from('AdminActionLog')
    .select('id, quizId, quizTitle, action, adminEmail, details, createdAt')
    .eq('quizId', quizId)
    .order('createdAt', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as QuizActionEntry[];
}
