import { getAdminDb } from '@/lib/supabase/db';

/**
 * Players' answers are stored as option numbers, and deleting a question deletes every answer to it
 * ("QuestionAttempt" cascades). So once a question has answers, removing it or changing its
 * options would silently delete or re-map players' predictions: every admin edit path refuses both
 * before it saves anything. The wording and the active/paused status can still change. The database
 * refuses the same changes (migration 20261024120000_protect_answers_and_winners).
 */

/** Option lists compared by value: the column holds a JSON string, and old rows may be spaced differently. */
export function sameOptions(stored: unknown, next: string[]): boolean {
  let current: unknown = stored;
  if (typeof stored === 'string') {
    try { current = JSON.parse(stored); } catch { return false; }
  }
  return Array.isArray(current) && current.length === next.length && current.every((option, i) => String(option) === next[i]);
}

// Lookups run this many at a time: an edit that touches every question of a 200-question quiz stays polite
const LOOKUP_BATCH = 20;

/**
 * The questions, of these, that at least one player answered (one indexed lookup per question). Every
 * answer is in "QuestionAttempt": the older copies in "Answer" all have their row there too (migration
 * 20261024170000 made sure).
 */
export async function answeredQuestionIds(questionIds: string[]): Promise<Set<string>> {
  const db = getAdminDb();
  const answered = new Set<string>();
  for (let i = 0; i < questionIds.length; i += LOOKUP_BATCH) {
    await Promise.all(questionIds.slice(i, i + LOOKUP_BATCH).map(async (id) => {
      const { data, error } = await db.from('QuestionAttempt').select('id').eq('questionId', id).limit(1);
      if (error) throw error;
      if ((data?.length ?? 0) > 0) answered.add(id);
    }));
  }
  return answered;
}

/** What the admin is told, naming the first question the change would have hit. */
export function answeredQuestionError(questionText: string, others = 0): string {
  const more = others > 0 ? ` (and ${others} more)` : '';
  return `Players have already answered "${questionText}"${more}, so it can't be removed and its options can't change. You can still edit its wording.`;
}
