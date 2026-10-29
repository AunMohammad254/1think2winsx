import { getAdminDb, generateId } from '@/lib/supabase/db';
import { logQuizAction } from '@/lib/admin-action-log';
import type { QuizAction } from '@/lib/admin-action-labels';
import { overQuestions } from '@/lib/match-questions';
import {
  applyEvent,
  reopenable,
  scoreInnings,
  targetFor,
  type Ball,
  type EndReason,
  type Extra,
  type InningsNumber,
  type MatchEvent,
  type MatchState,
  type MatchStatus,
} from '@/lib/match-engine';

/**
 * Match mode on the server (migration 20261029120000_match_mode): loads a match, applies the scorer
 * console's events through src/lib/match-engine.ts and apply_match_change, and builds what the console
 * shows. Admin-only: every caller has checked the admin session.
 */

export interface MatchRow {
  id: string;
  quizId: string;
  teamA: string;
  teamB: string;
  oversPerInnings: number;
  questionsPerOver: number;
  firstWindowSeconds: number;
  lockFallbackSeconds: number;
  status: MatchStatus;
  version: number;
  createdAt: string;
}

interface QuestionRow {
  id: string;
  text: string;
  options: string;
  matchInnings: InningsNumber;
  matchOver: number;
  market: string;
  marketParams: Record<string, unknown> | null;
  status: 'active' | 'paused';
  hasCorrectAnswer: boolean;
  correctOption: number | null;
  closesAt: string | null;
}

export interface LoadedMatch {
  row: MatchRow;
  title: string;
  /** Its quiz has been settled: the match can't change any more */
  settled: boolean;
  state: MatchState;
  questions: QuestionRow[];
}

type Joined<T> = T | T[] | null;
const one = <T>(value: Joined<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value);

const MATCH_COLUMNS = 'id, quizId, teamA, teamB, oversPerInnings, questionsPerOver, firstWindowSeconds, lockFallbackSeconds, status, version, createdAt';

/** The match with its innings, balls and questions, or null when there is none. */
export async function loadMatch(matchId: string, now = Date.now()): Promise<LoadedMatch | null> {
  const db = getAdminDb();
  const { data, error } = await db.from('LiveMatch').select(`${MATCH_COLUMNS}, Quiz:quizId (title)`).eq('id', matchId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { Quiz, ...row } = data as MatchRow & { Quiz: Joined<{ title: string }> };

  const [innings, balls, questions, settlement] = await Promise.all([
    db.from('MatchInnings').select('innings, battingTeam, endReason').eq('matchId', matchId).order('innings'),
    db.from('BallEvent').select('id, innings, seq, runs, extra, extraRuns, wicket').eq('matchId', matchId).is('undoneAt', null)
      .order('innings').order('seq'),
    db.from('Question')
      .select('id, text, options, matchInnings, matchOver, market, marketParams, status, hasCorrectAnswer, correctOption, closesAt')
      .eq('quizId', row.quizId).not('matchInnings', 'is', null).order('matchInnings').order('matchOver').order('createdAt'),
    db.from('QuizSettlement').select('quizId', { count: 'exact', head: true }).eq('quizId', row.quizId),
  ]);
  for (const result of [innings, balls, questions, settlement]) if (result.error) throw result.error;

  const questionRows = (questions.data || []) as QuestionRow[];
  return {
    row,
    title: one(Quiz)?.title ?? `${row.teamA} vs ${row.teamB}`,
    settled: (settlement.count ?? 0) > 0,
    questions: questionRows,
    state: {
      config: {
        teams: [row.teamA, row.teamB],
        oversPerInnings: row.oversPerInnings,
        questionsPerOver: row.questionsPerOver,
        firstWindowSeconds: row.firstWindowSeconds,
        lockFallbackSeconds: row.lockFallbackSeconds,
      },
      status: row.status,
      innings: (innings.data || []) as MatchState['innings'],
      balls: (balls.data || []) as Ball[],
      questions: questionRows.map((q) => ({
        id: q.id,
        innings: q.matchInnings,
        over: q.matchOver,
        market: q.market,
        params: q.marketParams ?? {},
        status: q.status,
        hasResult: q.hasCorrectAnswer,
        correctOption: q.correctOption,
        closed: q.closesAt !== null && Date.parse(q.closesAt) <= now,
      })),
    },
  };
}

// ── What the console shows ────────────────────────────────────────────────────────────────────────

const EXTRA_LABEL: Record<Extra, string> = { none: '', wide: 'Wd', no_ball: 'Nb', bye: 'B', leg_bye: 'Lb' };

/** A delivery as a scorecard writes it: 0, 4, 6, W, Wd, 1Wd, 4Nb, 2Lb, 1W */
export function ballLabel(ball: Pick<Ball, 'runs' | 'extra' | 'wicket'>): string {
  const extra = EXTRA_LABEL[ball.extra];
  if (ball.wicket) return `${ball.runs > 0 ? ball.runs : ''}${extra}W`;
  if (extra) return `${ball.runs > 0 ? ball.runs : ''}${extra}`;
  return String(ball.runs);
}

export type QuestionState = 'open' | 'closed' | 'settled' | 'void';

/** A delivery as the console shows it, with what it needs to correct it */
export interface ViewBall {
  id: string;
  label: string;
  runs: number;
  extra: Extra;
  wicket: boolean;
}

export interface MatchView {
  match: Omit<MatchRow, 'createdAt'> & { title: string };
  settled: boolean;
  innings: Array<{
    innings: InningsNumber;
    battingTeam: string;
    endReason: EndReason | null;
    runs: number;
    wickets: number;
    oversText: string;
    target: number | null;
    overs: Array<{ number: number; runs: number; wickets: number; complete: boolean; balls: ViewBall[] }>;
  }>;
  questions: Array<{
    id: string;
    innings: InningsNumber;
    over: number;
    text: string;
    options: string[];
    market: string;
    state: QuestionState;
    closesAt: string | null;
    correctOption: number | null;
    /** Closed early, and may take answers again (src/lib/match-engine.ts reopenable) */
    reopenable: boolean;
  }>;
  /** The server's clock, so the console counts down to close times correctly */
  serverNow: string;
}

function parseOptions(options: string): string[] {
  try {
    const parsed: unknown = JSON.parse(options);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function matchView(loaded: LoadedMatch, now = Date.now()): MatchView {
  const { row, state } = loaded;
  const canReopen = new Set(reopenable(state).map((q) => q.id));
  const { createdAt: _createdAt, ...match } = row;
  return {
    match: { ...match, title: loaded.title },
    settled: loaded.settled,
    innings: state.innings.map((record) => {
      const target = targetFor(record.innings, state.balls, row.oversPerInnings);
      const score = scoreInnings(state.balls.filter((ball) => ball.innings === record.innings), row.oversPerInnings, target);
      return {
        innings: record.innings,
        battingTeam: record.battingTeam,
        endReason: record.endReason,
        runs: score.runs,
        wickets: score.wickets,
        oversText: score.oversText,
        target,
        overs: score.overs.map((over) => ({
          number: over.number, runs: over.runs, wickets: over.wickets, complete: over.complete,
          balls: over.balls.map((ball) => ({ id: ball.id, label: ballLabel(ball), runs: ball.runs, extra: ball.extra, wicket: ball.wicket })),
        })),
      };
    }),
    questions: loaded.questions.map((q) => {
      const state: QuestionState = q.status === 'paused' ? 'void'
        : q.hasCorrectAnswer ? 'settled'
        : q.closesAt !== null && Date.parse(q.closesAt) <= now ? 'closed'
        : 'open';
      return {
        id: q.id,
        innings: q.matchInnings,
        over: q.matchOver,
        text: q.text,
        options: parseOptions(q.options),
        market: q.market,
        state,
        closesAt: q.closesAt,
        correctOption: state === 'settled' ? q.correctOption : null,
        reopenable: canReopen.has(q.id),
      };
    }),
    serverNow: new Date(now).toISOString(),
  };
}

// ── Changing a match ──────────────────────────────────────────────────────────────────────────────

export type MatchResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; error: string };

const refuse = (status: number, code: string, error: string) => ({ ok: false as const, status, code, error });

// Logged on the quiz's History tab; balls aren't (each keeps who recorded it)
const EVENT_ACTIONS: Partial<Record<MatchEvent['type'], QuizAction>> = {
  start_innings: 'match_innings_started',
  end_innings: 'match_innings_ended',
  undo: 'match_ball_undone',
  close_answers: 'match_answers_closed',
  abandon: 'match_abandoned',
  correct_ball: 'match_ball_corrected',
  resume_innings: 'match_innings_resumed',
  remove_innings: 'match_innings_removed',
  reopen_answers: 'match_answers_reopened',
  restore: 'match_restored',
};

/**
 * Applies one console event to the match, if the console saw the current `version`. Opens the questions
 * the engine asks for (src/lib/match-questions.ts) and returns the match as it now is.
 */
export async function applyMatchEvent(matchId: string, version: number, event: MatchEvent, admin: string): Promise<MatchResult<MatchView>> {
  const loaded = await loadMatch(matchId);
  if (!loaded) return refuse(404, 'not_found', 'Match not found');
  if (loaded.settled) return refuse(409, 'settled', "This match's quiz has been settled, so the match can't change any more");
  if (loaded.row.version !== version) return refuse(409, 'stale', 'Someone else changed this match first. It has been reloaded: check it and try again.');

  const outcome = applyEvent(loaded.state, event, generateId);
  if (!outcome.ok) return refuse(400, 'invalid', outcome.error);
  const { change, state } = outcome;

  const release = change.release.flatMap((slot) => {
    const record = state.innings.find((i) => i.innings === slot.innings)!;
    const score = scoreInnings(state.balls.filter((ball) => ball.innings === slot.innings), loaded.row.oversPerInnings, null);
    const questions = overQuestions({
      innings: slot.innings, over: slot.over, oversPerInnings: loaded.row.oversPerInnings,
      battingTeam: record.battingTeam, runs: score.runs, legalBalls: score.legalBalls,
    }, loaded.row.questionsPerOver);
    return questions.map((q) => ({
      id: generateId(), text: q.text, options: JSON.stringify(q.options), market: q.market, params: q.params,
      innings: slot.innings, over: slot.over, closesInSeconds: slot.closesInSeconds,
    }));
  });

  const { data, error } = await getAdminDb().rpc('apply_match_change', {
    p_match_id: matchId,
    p_version: version,
    p_change: { ...change, release, admin },
  });
  if (error) throw error;
  const result = data as { success: boolean; code?: string; error?: string };
  if (!result.success) {
    const code = result.code ?? 'error';
    return refuse(code === 'stale' ? 409 : code === 'not_found' ? 404 : 400, code, result.error ?? 'The change could not be saved');
  }

  const action = EVENT_ACTIONS[event.type];
  if (action) {
    await logQuizAction({ quizId: loaded.row.quizId, quizTitle: loaded.title, action, adminEmail: admin, details: { matchId, event } });
  }
  const reloaded = await loadMatch(matchId);
  return { ok: true, data: matchView(reloaded!) };
}

export interface NewMatch {
  teamA: string;
  teamB: string;
  oversPerInnings: number;
  questionsPerOver: number;
}

/** A new match and its draft quiz (create_live_match). */
export async function createMatch(input: NewMatch, admin: string): Promise<MatchResult<{ matchId: string; quizId: string }>> {
  const { data, error } = await getAdminDb().rpc('create_live_match', {
    p_team_a: input.teamA,
    p_team_b: input.teamB,
    p_overs: input.oversPerInnings,
    p_questions_per_over: input.questionsPerOver,
    p_admin: admin,
  });
  if (error) throw error;
  const result = data as { success: boolean; matchId?: string; quizId?: string; code?: string; error?: string };
  if (!result.success) return refuse(400, result.code ?? 'invalid', result.error ?? 'The match could not be created');
  await logQuizAction({
    quizId: result.quizId!, quizTitle: `${input.teamA.trim()} vs ${input.teamB.trim()}`, action: 'match_created', adminEmail: admin,
    details: { matchId: result.matchId, oversPerInnings: input.oversPerInnings, questionsPerOver: input.questionsPerOver },
  });
  return { ok: true, data: { matchId: result.matchId!, quizId: result.quizId! } };
}

export type MatchListItem = Pick<MatchRow, 'id' | 'quizId' | 'teamA' | 'teamB' | 'oversPerInnings' | 'status' | 'createdAt'>;

/** The newest matches first. */
export async function listMatches(limit = 100): Promise<MatchListItem[]> {
  const { data, error } = await getAdminDb()
    .from('LiveMatch')
    .select('id, quizId, teamA, teamB, oversPerInnings, status, createdAt')
    .order('createdAt', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as MatchListItem[];
}
