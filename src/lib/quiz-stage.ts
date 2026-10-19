/**
 * Where a quiz is in its settlement life: Open -> Awaiting result -> Ready to settle -> Settled.
 * Pure functions (the clock is passed in), shared by the admin settlement API and screen.
 */

export type QuizStage = 'upcoming' | 'open' | 'awaiting_result' | 'ready_to_settle' | 'settled';

export interface QuizStageInput {
  status: string;
  pushedAt: string | null;
  /** Answering window in minutes, counted from pushedAt */
  duration: number | null;
  settledAt: string | null;
  /** Active questions */
  totalQuestions: number;
  /** Active questions whose correct answer (the result) is saved */
  questionsWithResult: number;
}

// submit_quiz_attempt accepts answers until pushedAt + duration plus this grace period
const ANSWER_GRACE_MS = 30_000;
const NOT_LIVE_YET = new Set(['upcoming', 'scheduled', 'draft']);

/** When players can no longer answer, or null when the quiz has no answering window (never pushed). */
export function answeringClosesAt(pushedAt: string | null, duration: number | null): number | null {
  if (!pushedAt || !duration || duration <= 0) return null;
  const start = Date.parse(pushedAt);
  return Number.isFinite(start) ? start + duration * 60_000 + ANSWER_GRACE_MS : null;
}

export function quizStage(quiz: QuizStageInput, nowMs: number): QuizStage {
  if (quiz.settledAt) return 'settled';
  if (NOT_LIVE_YET.has(quiz.status)) return 'upcoming';
  if (quiz.totalQuestions > 0 && quiz.questionsWithResult === quiz.totalQuestions) return 'ready_to_settle';
  const closesAt = answeringClosesAt(quiz.pushedAt, quiz.duration);
  // A live quiz without a window stays open until the admin ends it by saving the result
  const open = closesAt === null ? quiz.status === 'active' : nowMs < closesAt;
  return open ? 'open' : 'awaiting_result';
}

export const STAGE_LABELS: Record<QuizStage, string> = {
  upcoming: 'Upcoming',
  open: 'Open',
  awaiting_result: 'Awaiting result',
  ready_to_settle: 'Ready to settle',
  settled: 'Settled',
};
