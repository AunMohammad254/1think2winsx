/**
 * Quiz settlement (admin): save a quiz's result, preview the winners, then pay 1st-3rd place once.
 * The money moves inside the `settle_quiz` database function, in one transaction that a second call
 * refuses (see db-tests/schema/06-20261019120000_quiz_settlement.sql); this module reads, validates
 * and notifies.
 */
import { getAdminDb, notificationDb, fetchAllByKeyset } from '@/lib/supabase/db';
import { answeringClosesAt, quizStage, type QuizStage } from '@/lib/quiz-stage';
import { invalidateQuizCatalog } from '@/lib/quiz-catalog';
import { DEFAULT_QUIZ_ADMIN_SETTINGS, getQuizAdminSettings, type QuizAdminSettings } from '@/lib/quiz-admin-settings';

export type TieRule = 'random' | 'earliest';
export interface Reward { rank: number; points?: number; prizeId?: string }

export interface SettlementQuiz {
  id: string;
  title: string;
  status: string;
  quizType: string;
  pushedAt: string | null;
  duration: number | null;
  /** When players can no longer answer (ISO), or null without an answering window */
  closesAt: string | null;
  totalQuestions: number;
  questionsWithResult: number;
  attempts: number;
  /** Admin-only: players admitted, first come first served, and the points pool settlement can share */
  maxEntries: number;
  pointsPool: number;
  settledAt: string | null;
  stage: QuizStage;
}

/**
 * The points pool settle_quiz paid (or, in a preview, would pay): the quiz's whole pool, in random
 * amounts, to the earliest `percent` of the entrants who scored above 0.
 */
export interface PoolSummary {
  /** Percentage of the entrants who get a share (0: the pool is not paid) */
  percent: number;
  poolSize: number;
  /** What was meant to be paid: the whole pool, or 0 without a percentage */
  target: number;
  /** ceil(entrants × percent / 100): how many of the earliest scorers get a share */
  places: number;
  /** What was actually paid: the target, or 0 when no entrant scored */
  paid: number;
  /** Entrants who scored above 0 */
  eligible: number;
  recipients: number;
  min: number;
  max: number;
}

export interface SettlementPrize { id: string; name: string; category: string; stock: number; imageUrl: string | null }

export interface SettlementQuestion { id: string; text: string; options: string[]; correctOption: number | null }

export interface SettledWinner {
  rank: number;
  userId: string;
  name: string | null;
  email: string | null;
  score: number;
  selectionMethod: string;
  points: number | null;
  prizeId: string | null;
  prizeName: string | null;
  prizeCategory: string | null;
}

export interface SettlementDetail {
  quiz: SettlementQuiz;
  questions: SettlementQuestion[];
  settlement: {
    settledAt: string; settledBy: string; tieRule: string; seed: string; winners: SettledWinner[];
    /** The pool share paid at settlement: percent, points and how many players got some */
    pool: { percent: number; points: number; recipients: number };
  } | null;
}

/** What settle_quiz returns: the winners on success, or a code the API maps to an HTTP status. */
export type SettleResult =
  | {
      success: true;
      preview?: boolean;
      quizId: string;
      quizTitle: string;
      participants: number;
      questions: number;
      tieRule: TieRule;
      seed: string;
      winners: Array<SettledWinner & { tiedWith: number }>;
      unfilled: number[];
      /** recipientIds: every player who got a share (for notifying them); never sent to the browser */
      pool: PoolSummary & { recipientIds: string[] };
    }
  | { success: false; code: 'not_found' | 'already_settled' | 'result_missing' | 'out_of_stock' | 'invalid'; error: string };

type QuizRow = { id: string; title: string; status: string; quizType: string | null; pushedAt: string | null; duration: number | null };

export function parseOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function summarise(
  quiz: QuizRow,
  counts: { total: number; withResult: number; attempts: number },
  settings: QuizAdminSettings,
  settledAt: string | null,
  nowMs: number,
): SettlementQuiz {
  const closes = answeringClosesAt(quiz.pushedAt, quiz.duration);
  return {
    id: quiz.id,
    title: quiz.title,
    status: quiz.status,
    quizType: quiz.quizType || 'normal',
    pushedAt: quiz.pushedAt,
    duration: quiz.duration,
    closesAt: closes === null ? null : new Date(closes).toISOString(),
    totalQuestions: counts.total,
    questionsWithResult: counts.withResult,
    attempts: counts.attempts,
    maxEntries: settings.maxEntries,
    pointsPool: settings.pointsPool,
    settledAt,
    stage: quizStage({
      status: quiz.status,
      pushedAt: quiz.pushedAt,
      duration: quiz.duration,
      settledAt,
      totalQuestions: counts.total,
      questionsWithResult: counts.withResult,
    }, nowMs),
  };
}

async function attemptCounts(quizIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (quizIds.length === 0) return counts;
  const { data, error } = await getAdminDb().rpc('get_quiz_attempt_counts_by_quiz', { quiz_ids: quizIds });
  if (error) throw error;
  for (const row of (data || []) as Array<{ quiz_id: string; attempt_count: number | string }>) {
    counts.set(row.quiz_id, Number(row.attempt_count) || 0);
  }
  return counts;
}

/** Each quiz's entry limit and pool; the defaults when none are saved or the table can't be read. */
async function adminSettings(quizIds: string[]): Promise<(quizId: string) => QuizAdminSettings> {
  let saved = new Map<string, QuizAdminSettings>();
  try {
    saved = await getQuizAdminSettings(quizIds);
  } catch (error) {
    console.error('[quiz-settlement] Loading entry limits and points pools failed:', error);
  }
  return (quizId) => saved.get(quizId) ?? DEFAULT_QUIZ_ADMIN_SETTINGS;
}

/** Every quiz with its stage, plus the prizes (bumper ones included) that can be given as rewards. */
export async function listSettlementQuizzes(nowMs: number): Promise<{ quizzes: SettlementQuiz[]; prizes: SettlementPrize[] }> {
  const db = getAdminDb();
  const [quizzesRes, prizesRes] = await Promise.all([
    db.from('Quiz').select('id, title, status, quizType, pushedAt, duration').order('createdAt', { ascending: false }).limit(500),
    db.from('Prize').select('id, name, category, stock, imageUrl').eq('isActive', true).order('name', { ascending: true }),
  ]);
  if (quizzesRes.error) throw quizzesRes.error;
  if (prizesRes.error) throw prizesRes.error;
  const quizzes = (quizzesRes.data || []) as QuizRow[];
  const ids = quizzes.map((q) => q.id);

  const [questions, attempts, settlementsRes, settingsFor] = await Promise.all([
    ids.length
      ? fetchAllByKeyset<{ id: string; quizId: string; hasCorrectAnswer: boolean }>(
          (after, limit) => {
            let q = db.from('Question').select('id, quizId, hasCorrectAnswer').in('quizId', ids).eq('status', 'active');
            if (after) q = q.gt('id', after);
            return q.order('id', { ascending: true }).limit(limit);
          },
          (row) => row.id,
        )
      : Promise.resolve([]),
    attemptCounts(ids),
    ids.length
      ? db.from('QuizSettlement').select('quizId, settledAt').in('quizId', ids)
      : Promise.resolve({ data: [], error: null }),
    adminSettings(ids),
  ]);
  if (settlementsRes.error) throw settlementsRes.error;

  const questionCounts = new Map<string, { total: number; withResult: number }>();
  for (const q of questions) {
    const c = questionCounts.get(q.quizId) || { total: 0, withResult: 0 };
    c.total += 1;
    if (q.hasCorrectAnswer) c.withResult += 1;
    questionCounts.set(q.quizId, c);
  }
  const settledAt = new Map(((settlementsRes.data || []) as Array<{ quizId: string; settledAt: string }>).map((s) => [s.quizId, s.settledAt]));

  return {
    quizzes: quizzes.map((quiz) => summarise(
      quiz,
      { ...(questionCounts.get(quiz.id) || { total: 0, withResult: 0 }), attempts: attempts.get(quiz.id) || 0 },
      settingsFor(quiz.id),
      settledAt.get(quiz.id) ?? null,
      nowMs,
    )),
    prizes: ((prizesRes.data || []) as SettlementPrize[]).map((p) => ({ ...p, stock: Number(p.stock) || 0 })),
  };
}

/** One quiz: its questions with any saved result, and the settlement with its winners once settled. */
export async function getSettlementDetail(quizId: string, nowMs: number): Promise<SettlementDetail | null> {
  const db = getAdminDb();
  const [quizRes, questionsRes, settlementRes, attempts, settingsFor] = await Promise.all([
    db.from('Quiz').select('id, title, status, quizType, pushedAt, duration').eq('id', quizId).maybeSingle(),
    db.from('Question').select('id, text, options, correctOption, hasCorrectAnswer')
      .eq('quizId', quizId).eq('status', 'active').order('createdAt', { ascending: true }),
    // `*`: the pool columns come from a migration (06-20261022120000) and naming them before it is applied fails the read
    db.from('QuizSettlement').select('*').eq('quizId', quizId).maybeSingle(),
    attemptCounts([quizId]),
    adminSettings([quizId]),
  ]);
  if (quizRes.error) throw quizRes.error;
  if (questionsRes.error) throw questionsRes.error;
  if (settlementRes.error) throw settlementRes.error;
  if (!quizRes.data) return null;

  const rows = (questionsRes.data || []) as Array<{ id: string; text: string; options: unknown; correctOption: number | null; hasCorrectAnswer: boolean }>;
  const isNormalQuiz = (quizRes.data as QuizRow).quizType === 'normal';
  const settlement = settlementRes.data as {
    settledAt: string; settledBy: string; tieRule: string; seed: string; poolPercent?: number | string; poolPoints?: number;
  } | null;

  let winners: SettledWinner[] = [];
  let poolRecipients = 0;
  if (settlement && (settlement.poolPoints ?? 0) > 0) {
    const { count, error } = await db.from('QuizPoolShare').select('*', { count: 'exact', head: true }).eq('quizId', quizId);
    if (error) throw error;
    poolRecipients = count ?? 0;
  }
  if (settlement) {
    const { data, error } = await db.from('QuizWinner')
      .select('rank, userId, score, selectionMethod, pointsAwarded, prizeId, User:userId (name, email), Prize:prizeId (name, category)')
      .eq('quizId', quizId)
      .order('rank', { ascending: true });
    if (error) throw error;
    type Joined<T> = T | T[] | null;
    const one = <T,>(v: Joined<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);
    winners = ((data || []) as Array<{
      rank: number; userId: string; score: number; selectionMethod: string; pointsAwarded: number; prizeId: string | null;
      User: Joined<{ name: string | null; email: string | null }>; Prize: Joined<{ name: string; category: string }>;
    }>).map((w) => ({
      rank: w.rank,
      userId: w.userId,
      name: one(w.User)?.name ?? null,
      email: one(w.User)?.email ?? null,
      score: w.score,
      selectionMethod: w.selectionMethod,
      points: w.pointsAwarded > 0 ? w.pointsAwarded : null,
      prizeId: w.prizeId,
      prizeName: one(w.Prize)?.name ?? null,
      prizeCategory: one(w.Prize)?.category ?? null,
    }));
  }

  return {
    quiz: summarise(
      quizRes.data as QuizRow,
      { total: rows.length, withResult: rows.filter((q) => q.hasCorrectAnswer).length, attempts: attempts.get(quizId) || 0 },
      settingsFor(quizId),
      settlement?.settledAt ?? null,
      nowMs,
    ),
    questions: rows.map((q) => ({
      id: q.id,
      text: q.text,
      options: parseOptions(q.options),
      // The saved result, or a normal quiz's answer key typed when it was made, which pre-fills the
      // result form (only saving the result closes the question). A prediction has no key before it.
      correctOption: q.hasCorrectAnswer || isNormalQuiz ? q.correctOption : null,
    })),
    settlement: settlement
      ? {
          settledAt: settlement.settledAt,
          settledBy: settlement.settledBy,
          tieRule: settlement.tieRule,
          seed: settlement.seed,
          winners,
          pool: { percent: Number(settlement.poolPercent) || 0, points: settlement.poolPoints ?? 0, recipients: poolRecipients },
        }
      : null,
  };
}

export type SaveResultOutcome = { ok: true } | { ok: false; status: number; code: string; error: string };

/**
 * Save the correct option of every question. This closes those questions to new answers, so while
 * the quiz is still open it needs `endNow` (the admin's explicit "End quiz now").
 */
export async function saveQuizResult(quizId: string, answers: Record<string, number>, endNow: boolean, nowMs: number): Promise<SaveResultOutcome> {
  const detail = await getSettlementDetail(quizId, nowMs);
  if (!detail) return { ok: false, status: 404, code: 'not_found', error: 'Quiz not found' };
  const { stage } = detail.quiz;
  if (stage === 'settled') return { ok: false, status: 409, code: 'already_settled', error: 'This quiz has already been settled' };
  if (stage === 'upcoming') return { ok: false, status: 409, code: 'not_started', error: "This quiz hasn't started yet" };
  if (stage === 'open' && !endNow) {
    return { ok: false, status: 409, code: 'still_open', error: 'Players can still answer. End the quiz to save its result.' };
  }
  if (detail.questions.length === 0) return { ok: false, status: 400, code: 'invalid', error: 'This quiz has no active questions' };
  for (const q of detail.questions) {
    const option = answers[q.id];
    if (!Number.isInteger(option) || option < 0 || option >= q.options.length) {
      return { ok: false, status: 400, code: 'invalid', error: `Choose the correct option for: ${q.text}` };
    }
  }

  const db = getAdminDb();
  for (const q of detail.questions) {
    const { data, error } = await db.rpc('evaluate_question', { p_question_id: q.id, p_correct_option: answers[q.id] });
    if (error || !(data as { success?: boolean } | null)?.success) throw error || new Error(`evaluate_question failed for ${q.id}`);
  }
  const { data, error } = await db.rpc('finalize_quiz_scores', { p_quiz_id: quizId });
  if (error || !(data as { success?: boolean } | null)?.success) throw error || new Error('finalize_quiz_scores failed');
  // The closed questions leave the players' catalogue now, not when its cache next expires
  invalidateQuizCatalog();
  return { ok: true };
}

/**
 * Run settle_quiz; with dryRun it returns the same winners and pool shares and changes nothing.
 * `poolPercent`: the share of the quiz's points pool to split at random among the entrants who scored.
 */
export async function runSettlement(input: {
  quizId: string; rewards: Reward[]; tieRule: TieRule; seed: string; settledBy: string; dryRun: boolean; poolPercent: number;
}): Promise<SettleResult> {
  const { data, error } = await getAdminDb().rpc('settle_quiz', {
    p_quiz_id: input.quizId,
    p_rewards: input.rewards,
    p_tie_rule: input.tieRule,
    p_seed: input.seed,
    p_settled_by: input.settledBy,
    p_dry_run: input.dryRun,
    p_pool_percent: input.poolPercent,
  });
  if (error) throw error;
  return data as SettleResult;
}

/** A settle result for the admin's browser: the pool summary without the list of every recipient. */
export function settleResultForBrowser(result: Extract<SettleResult, { success: true }>) {
  // settle_quiz from before migration 06-20261022120000 returns no pool: the settlement still happened
  if (!result.pool) return result;
  const { recipientIds: _recipientIds, ...pool } = result.pool;
  return { ...result, pool };
}

const PLACE = ['', '1st', '2nd', '3rd'];

/**
 * Tell each winner what they won (only they see a bumper prize's name) and everyone else that the
 * results are in. Best effort: the settlement already happened, so a failure here is only logged.
 */
export async function notifySettlement(result: Extract<SettleResult, { success: true }>): Promise<boolean> {
  try {
    const db = getAdminDb();
    for (const w of result.winners) {
      const reward = w.prizeName ? w.prizeName : `${w.points} points`;
      await notificationDb.create(w.userId, {
        title: `🏆 You placed ${PLACE[w.rank]}!`,
        message: w.prizeName
          ? `You won ${reward} in "${result.quizTitle}". Our team will contact you about delivery.`
          : `You won ${reward} in "${result.quizTitle}".`,
        type: 'prize_won',
        link: '/profile',
      });
    }
    if (result.winners.length > 0) {
      const { error } = await db.from('QuizWinner')
        .update({ notificationSent: true, updatedAt: new Date().toISOString() })
        .eq('quizId', result.quizId)
        .in('userId', result.winners.map((w) => w.userId));
      if (error) throw error;
    }

    const attempts = await fetchAllByKeyset<{ id: string; userId: string }>(
      (after, limit) => {
        let q = db.from('QuizAttempt').select('id, userId').eq('quizId', result.quizId).eq('isCompleted', true);
        if (after) q = q.gt('id', after);
        return q.order('id', { ascending: true }).limit(limit);
      },
      (a) => a.id,
    );
    // Pool shares differ per player, so one message for all of them points to the profile for the amount
    const poolIds = new Set(result.pool?.recipientIds ?? []);
    if (poolIds.size > 0) {
      await notificationDb.createBatchForUsers([...poolIds], {
        title: '🎁 Bonus points',
        message: `You received bonus points in "${result.quizTitle}". See your profile for your points.`,
        type: 'prize_won',
        link: '/profile',
      });
    }
    const winnerIds = new Set(result.winners.map((w) => w.userId));
    const others = [...new Set(attempts.map((a) => a.userId))].filter((id) => !winnerIds.has(id) && !poolIds.has(id));
    await notificationDb.createBatchForUsers(others, {
      title: '🏅 Results are in',
      message: `Results for "${result.quizTitle}" are in. See how you did.`,
      type: 'general',
      link: `/quiz/${result.quizId}/results`,
    });
    return true;
  } catch (error) {
    console.error('[quiz-settlement] Notifying players failed:', error);
    return false;
  }
}
