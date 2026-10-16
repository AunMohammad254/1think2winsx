import { getAdminDb, notificationDb } from '@/lib/supabase/db';
import logger from '@/lib/logger';

/**
 * Scheduled-quiz go-live logic, shared by the cron endpoint and the quiz catalogue.
 *
 * The cron endpoint is the primary trigger, but Hostinger has no scheduler and
 * Vercel's free cron is daily, so a quiz could sit past its start time until some
 * visitor happened to kick the cron. The catalogue (read on every quiz list/open)
 * therefore calls this too, which makes go-live happen on the first read after
 * `startsAt` with no external scheduler.
 *
 * Safe to call from several processes at once: each quiz is claimed with a
 * conditional UPDATE, so only one caller activates (and broadcasts) it.
 */

export interface ActivatedQuiz {
  id: string;
  title: string | null;
}

export interface DueQuizResult {
  activated: ActivatedQuiz[];
  /** Epoch ms of the next scheduled/upcoming quiz start still in the future, if any. */
  nextDueAt: number | null;
}

const PENDING_STATUSES = ['scheduled', 'upcoming'];

// Titles tell the admin's "upcoming" announcement and the automatic 10-minute
// warning apart (both are type `quiz_starts_soon` and share a link per quiz).
export const UPCOMING_NOTICE_TITLE = '📅 Upcoming Quiz!';
export const TEN_MINUTE_WARNING_TITLE = '⏰ Sports Quiz Starts in 10 Min!';

/**
 * Link for pre-start announcements. Not `?openQuiz=`: a scheduled quiz is not
 * visible to users yet, so opening it would 404. The id keeps the link unique per
 * quiz, which the duplicate checks rely on.
 */
export const upcomingQuizLink = (quizId: string) => `/quizzes?upcoming=${quizId}`;

export async function activateDueQuizzes(): Promise<DueQuizResult> {
  const adminDb = getAdminDb();
  const now = new Date().toISOString();

  const { data: due, error } = await adminDb
    .from('Quiz')
    .select('id, title')
    .in('status', PENDING_STATUSES)
    .lte('startsAt', now);
  if (error) throw error;

  const activated: ActivatedQuiz[] = [];
  for (const quiz of due || []) {
    const { data: claimed, error: updateError } = await adminDb
      .from('Quiz')
      .update({ status: 'active', pushedAt: now, updatedAt: now })
      .eq('id', quiz.id)
      .in('status', PENDING_STATUSES)
      .select('id');

    if (updateError) {
      console.error(`[QuizScheduler] Failed to activate quiz ${quiz.id}:`, updateError);
      continue;
    }
    // Another process claimed it first.
    if (!claimed || claimed.length === 0) continue;

    activated.push({ id: quiz.id, title: quiz.title });
  }

  const { data: next } = await adminDb
    .from('Quiz')
    .select('startsAt')
    .in('status', PENDING_STATUSES)
    .gt('startsAt', now)
    .order('startsAt', { ascending: true })
    .limit(1);
  const nextDueAt = next?.[0]?.startsAt ? new Date(next[0].startsAt).getTime() : null;

  return { activated, nextDueAt };
}

/** Tells every user a scheduled quiz just went live. Can be slow on large user bases. */
export async function broadcastQuizLive(quiz: ActivatedQuiz): Promise<void> {
  await notificationDb.createBroadcast({
    title: '🔴 Live now',
    message: `"${quiz.title || 'Challenge'}" was just pushed (Scheduled) — jump in now!`,
    type: 'quiz_deadline',
    link: `/quizzes?openQuiz=${quiz.id}`,
  });
  logger.log(`[QuizScheduler] Activated quiz ${quiz.id} and sent notification broadcast.`);
}
