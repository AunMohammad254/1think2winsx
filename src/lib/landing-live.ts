import type { LiveSnapshot } from '@/lib/live-catalog';
import { computeQuizEndsAt } from '@/lib/quiz-clock';

/**
 * What the landing page shows from the public quiz snapshot (GET /api/live, cached at Cloudflare).
 *
 * Pure functions with the clock passed in, so the cards, the countdown and the empty state can be
 * tested without a browser.
 */

/** live: pushed, inside its answering window. open: active and never pushed (playable any time). */
export type LandingQuizState = 'live' | 'open' | 'upcoming';

export interface LandingQuiz {
  id: string;
  title: string;
  state: LandingQuizState;
  /** Upcoming quizzes: when the scheduler makes it live (null when no time was set). */
  startsAtMs: number | null;
  /** Live quizzes: when the answering window closes. */
  endsAtMs: number | null;
  prize: string;
  hasPrize: boolean;
  isBumperPrize: boolean;
  entry: string;
  questionCount: number;
  duration: number;
  totalAttempts: number;
}

/** The carousel was designed for three cards; a few more still fit its dots. */
export const MAX_LANDING_QUIZZES = 5;

const STATE_ORDER: Record<LandingQuizState, number> = { live: 0, open: 1, upcoming: 2 };

const parseMs = (value: string | null) => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const formatPkr = (amount: number) => `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} PKR`;

/**
 * The quizzes a visitor could join now or soon: live and always-open quizzes first (soonest to close
 * first), then upcoming ones by start time. A quiz whose answering window has closed, a paused one,
 * or a playable one without questions is left out.
 */
export function toLandingQuizzes(snapshot: LiveSnapshot, nowMs: number): LandingQuiz[] {
  const list: LandingQuiz[] = [];
  for (const quiz of snapshot.quizzes) {
    let state: LandingQuizState;
    let endsAtMs: number | null = null;
    if (quiz.status === 'upcoming') {
      state = 'upcoming';
    } else if (quiz.status === 'active' && quiz.questionCount > 0) {
      endsAtMs = parseMs(computeQuizEndsAt(quiz.pushedAt, quiz.duration));
      if (endsAtMs !== null && endsAtMs <= nowMs) continue;
      state = endsAtMs === null ? 'open' : 'live';
    } else {
      continue;
    }
    list.push({
      id: quiz.id,
      title: quiz.title,
      state,
      startsAtMs: state === 'upcoming' ? parseMs(quiz.startsAt) : null,
      endsAtMs,
      prize: quiz.prizeName ?? (quiz.isBumperPrize ? 'Bumper prize' : 'Leaderboard points'),
      hasPrize: !!quiz.prizeName || quiz.isBumperPrize,
      isBumperPrize: quiz.isBumperPrize,
      // With the wallet off nobody pays, whatever the quiz's price says
      entry: snapshot.walletEnabled && quiz.accessPrice > 0 ? formatPkr(quiz.accessPrice) : 'Free',
      questionCount: quiz.questionCount,
      duration: quiz.duration,
      totalAttempts: quiz.totalAttempts,
    });
  }
  const sortKey = (q: LandingQuiz) => q.endsAtMs ?? q.startsAtMs ?? Number.MAX_SAFE_INTEGER;
  return list
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || sortKey(a) - sortKey(b))
    .slice(0, MAX_LANDING_QUIZZES);
}

/** The soonest start time still ahead, or null when nothing is scheduled. */
export function nextQuizStart(quizzes: LandingQuiz[], nowMs: number): number | null {
  let next: number | null = null;
  for (const quiz of quizzes) {
    if (quiz.startsAtMs !== null && quiz.startsAtMs > nowMs && (next === null || quiz.startsAtMs < next)) next = quiz.startsAtMs;
  }
  return next;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Time left as "2d 04h 05m", "02h 14m" (with seconds: "02h 14m 05s") or "14m 05s". Seconds are always
 * shown in the last hour, where the countdown is worth watching.
 */
export function formatCountdown(ms: number, withSeconds = false): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return withSeconds ? `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s` : `${pad(hours)}h ${pad(minutes)}m`;
  return `${pad(minutes)}m ${pad(seconds)}s`;
}
