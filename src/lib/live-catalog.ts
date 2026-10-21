import type { CatalogQuiz } from '@/lib/quiz-catalog';

/**
 * Cached polling for live updates (F1).
 *
 * Players used to hold a Supabase Realtime connection each, and the plan allows 500 at once. Instead
 * every player now checks GET /api/live every few seconds: the PUBLIC part of the quiz list, the same
 * for everyone, which Cloudflare caches for 5 s. However many players are online, the origin sees about
 * one request per Cloudflare location per 5 s, and nobody needs a Realtime connection.
 *
 * The page merges the snapshot into the list it already holds: a quiz going live, a new quiz or a
 * removed one is applied in place, with no request of its own. Per-player fields (completed, new
 * questions) only come from the personal /api/quizzes response, which now runs every few minutes.
 */

export type PushStatus = 'unanswered' | 'answered' | 'upcoming' | 'time-up' | null;

/** The card badge, from the quiz's state and whether this player has completed it. */
export function computePushStatus(status: string, pushedAt: unknown, isCompleted: boolean): PushStatus {
  if (status === 'upcoming') return 'upcoming';
  if (!pushedAt) return null;
  if (isCompleted) return 'answered';
  // The catalogue only holds active, upcoming and paused quizzes
  return status === 'paused' ? 'time-up' : 'unanswered';
}

export interface LiveQuiz {
  id: string;
  title: string;
  description: string;
  duration: number;
  passingScore: number;
  status: string;
  questionCount: number;
  totalAttempts: number;
  pushedAt: string | null;
  startsAt: string | null;
  /** Upcoming quizzes: when players were last told it is coming (a new value pops it up on the stream). */
  announcedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** What the landing page's cards show: the linked prize, the bumper flag and the day-pass price. */
  prizeName: string | null;
  isBumperPrize: boolean;
  accessPrice: number;
}

export interface LiveSnapshot {
  version: string;
  quizzes: LiveQuiz[];
  /** Off means every quiz is free, whatever its `accessPrice` says. */
  walletEnabled: boolean;
}

// Same shape the personal list sends (Dates serialised as ISO strings), so merged and fetched
// entries compare equal and a quiz's pushedAt never looks "new" just because of formatting
const iso = (value: string | null) => (value ? new Date(value).toISOString() : null);

/** The public fields of a catalogue quiz: no questions, no answer key, nothing per player. */
export function toLiveQuiz(quiz: CatalogQuiz): LiveQuiz {
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    duration: quiz.duration,
    passingScore: quiz.passingScore,
    status: quiz.status,
    questionCount: quiz.questions.length,
    totalAttempts: quiz.totalAttempts,
    pushedAt: iso(quiz.pushedAt),
    startsAt: quiz.status === 'upcoming' ? iso(quiz.startsAt) : null,
    announcedAt: quiz.status === 'upcoming' ? iso(quiz.announcedAt) : null,
    createdAt: iso(quiz.createdAt) as string,
    updatedAt: iso(quiz.updatedAt) as string,
    prizeName: quiz.prizeName ?? null,
    isBumperPrize: !!quiz.isBumperPrize,
    accessPrice: Number(quiz.accessPrice) || 0,
  };
}

export interface LiveListItem {
  id: string;
  status: string;
  questionCount: number;
  hasAccess: boolean;
  isCompleted?: boolean;
  pushStatus?: PushStatus;
}

/**
 * Merge a snapshot into the player's list. The snapshot decides which quizzes are listed, in what
 * order, and their public fields; the player's own fields (completed, score, new questions) are kept.
 * A quiz the player has not seen yet cannot have been attempted, so it is added with fresh defaults.
 *
 * `needsPersonalFetch`: questions were added to or removed from a quiz this player completed, which
 * changes its "new questions" badge, and only the personal list knows which questions they answered.
 */
export function mergeLiveQuizzes<T extends LiveListItem>(
  list: T[],
  live: LiveQuiz[],
  hasAccess: boolean,
): { list: T[]; needsPersonalFetch: boolean } {
  const byId = new Map(list.map((q) => [q.id, q]));
  let needsPersonalFetch = false;
  const merged = live.map((quiz) => {
    const prev = byId.get(quiz.id);
    const isCompleted = !!prev?.isCompleted;
    if (prev && isCompleted && prev.questionCount !== quiz.questionCount) needsPersonalFetch = true;
    const playerFields = prev ?? { hasAccess, isCompleted: false, hasNewQuestions: false, newQuestionsCount: 0, lastAttemptDate: null };
    return { ...playerFields, ...quiz, pushStatus: computePushStatus(quiz.status, quiz.pushedAt, isCompleted) } as unknown as T;
  });
  return { list: merged, needsPersonalFetch };
}

/**
 * Window event the quiz page fires with the unread notification count its personal list carries, so
 * the navbar bell does not make a request of its own while the page keeps it current.
 */
export const UNREAD_COUNT_EVENT = 'quizzes:unread-count';

/**
 * Window event the quiz page fires when the live snapshot shows a quiz pushed live or announced. The
 * server stored a notification for every player at the same moment, so the bell counts it at once
 * instead of waiting for its next poll.
 */
export const NEW_NOTICE_EVENT = 'quizzes:new-notice';
