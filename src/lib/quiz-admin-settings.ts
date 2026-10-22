import { getAdminDb } from '@/lib/supabase/db';
import { DEFAULT_MAX_ENTRIES } from '@/lib/quiz-entries';

/**
 * A quiz's admin-only settings ("QuizAdminSettings"): how many players it admits, first come first
 * served, and the points pool settlement can share. Server-only: players can read every column of
 * "Quiz", so these live in a table only the service role can reach. A quiz without a row has the
 * defaults (the same ones submit_quiz_attempt and settle_quiz use).
 */
export interface QuizAdminSettings { maxEntries: number; pointsPool: number }

export const DEFAULT_QUIZ_ADMIN_SETTINGS: QuizAdminSettings = { maxEntries: DEFAULT_MAX_ENTRIES, pointsPool: 0 };

/** PostgREST's "no such table" (PGRST205) and Postgres's (42P01): the migration is not applied yet. */
const isMissingTable = (error: { code?: string }) => error.code === 'PGRST205' || error.code === '42P01';

/**
 * The saved settings of these quizzes (a quiz without a row has the defaults). Before the migration
 * there is no table and nothing can have been saved, so every quiz has the defaults. Any other error
 * is thrown: showing the defaults then would let an admin overwrite the real limit and pool, or settle
 * a quiz without paying its pool.
 */
export async function getQuizAdminSettings(quizIds: string[]): Promise<Map<string, QuizAdminSettings>> {
  const settings = new Map<string, QuizAdminSettings>();
  if (quizIds.length === 0) return settings;
  const { data, error } = await getAdminDb()
    .from('QuizAdminSettings')
    .select('quizId, maxEntries, pointsPool')
    .in('quizId', quizIds);
  if (error) {
    if (isMissingTable(error)) return settings;
    throw error;
  }
  for (const row of (data || []) as Array<{ quizId: string } & QuizAdminSettings>) {
    settings.set(row.quizId, { maxEntries: row.maxEntries, pointsPool: row.pointsPool });
  }
  return settings;
}

export async function saveQuizAdminSettings(quizId: string, settings: QuizAdminSettings): Promise<void> {
  const { error } = await getAdminDb()
    .from('QuizAdminSettings')
    .upsert({ quizId, ...settings, updatedAt: new Date().toISOString() }, { onConflict: 'quizId' });
  if (error) throw error;
}
