import { getAdminDb, generateId } from '@/lib/supabase/db';
import { logQuizAction } from '@/lib/admin-action-log';
import type { QuizAction } from '@/lib/admin-action-labels';
import { overQuestions } from '@/lib/match-questions';
import { aiWording, wordingProblem } from '@/lib/match-wording';
import {
  applyEvent,
  reopenable,
  scoreInnings,
  stillSendable,
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
 *
 * An over's questions are worded by Gemini or the built-in templates (src/lib/match-wording.ts), in
 * English and Roman Urdu. Unless the match sends them automatically, they wait as drafts
 * (migration 20261031120000_match_question_review) until an admin sends, edits or skips them.
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
  /** Send an over's questions as they are written, without review */
  autoSend: boolean;
  version: number;
  createdAt: string;
}

/** An over question waiting for an admin, as "LiveMatch".drafts stores it */
export interface MatchDraft {
  /** The question's id once sent */
  id: string;
  innings: InningsNumber;
  over: number;
  market: string;
  params: Record<string, number>;
  options: string[];
  /** The wording that goes out unless edited: Gemini's, or the built-in one */
  text: string;
  textRomanUrdu: string;
  /** The built-in wording, one click away in the console */
  plainText: string;
  plainTextRomanUrdu: string;
  /** Gemini worded it */
  ai: boolean;
  /** When it would close if sent: its over's answering window, from when it was written */
  closesAt: string;
  skipped?: boolean;
}

interface QuestionRow {
  id: string;
  text: string;
  textRomanUrdu: string | null;
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
  drafts: MatchDraft[];
}

type Joined<T> = T | T[] | null;
const one = <T>(value: Joined<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value);

const MATCH_COLUMNS = 'id, quizId, teamA, teamB, oversPerInnings, questionsPerOver, firstWindowSeconds, lockFallbackSeconds, status, autoSend, version, createdAt, drafts';

/** The match with its innings, balls and questions, or null when there is none. */
export async function loadMatch(matchId: string, now = Date.now()): Promise<LoadedMatch | null> {
  const db = getAdminDb();
  const { data, error } = await db.from('LiveMatch').select(`${MATCH_COLUMNS}, Quiz:quizId (title)`).eq('id', matchId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { Quiz, drafts, ...row } = data as MatchRow & { Quiz: Joined<{ title: string }>; drafts: MatchDraft[] | null };
  const draftList = drafts ?? [];

  const [innings, balls, questions, settlement] = await Promise.all([
    db.from('MatchInnings').select('innings, battingTeam, endReason').eq('matchId', matchId).order('innings'),
    db.from('BallEvent').select('id, innings, seq, runs, extra, extraRuns, wicket').eq('matchId', matchId).is('undoneAt', null)
      .order('innings').order('seq'),
    db.from('Question')
      .select('id, text, textRomanUrdu, options, matchInnings, matchOver, market, marketParams, status, hasCorrectAnswer, correctOption, closesAt')
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
    drafts: draftList,
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
      draftSlots: draftList.map((d) => ({ innings: d.innings, over: d.over })),
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
    textRomanUrdu: string | null;
    options: string[];
    market: string;
    state: QuestionState;
    closesAt: string | null;
    correctOption: number | null;
    /** Closed early, and may take answers again (src/lib/match-engine.ts reopenable) */
    reopenable: boolean;
  }>;
  /** Over questions written but not out: waiting for review, too late to send now, or skipped */
  drafts: Array<Omit<MatchDraft, 'skipped'> & { state: DraftState; line: number | null }>;
  /** The server's clock, so the console counts down to close times correctly */
  serverNow: string;
}

export type DraftState = 'waiting' | 'too_late' | 'skipped';

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
        textRomanUrdu: q.textRomanUrdu,
        options: parseOptions(q.options),
        market: q.market,
        state,
        closesAt: q.closesAt,
        correctOption: state === 'settled' ? q.correctOption : null,
        reopenable: canReopen.has(q.id),
      };
    }),
    drafts: loaded.drafts.map(({ skipped, ...draft }) => ({
      ...draft,
      line: typeof draft.params.line === 'number' ? draft.params.line : null,
      state: skipped ? 'skipped' as const : stillSendable(state, draft, Date.parse(draft.closesAt), now) ? 'waiting' as const : 'too_late' as const,
    })),
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

/** What apply_match_change answers */
type ChangeResult = { success: boolean; code?: string; error?: string };

async function saveChange(matchId: string, version: number, change: Record<string, unknown>): Promise<ChangeResult> {
  const { data, error } = await getAdminDb().rpc('apply_match_change', { p_match_id: matchId, p_version: version, p_change: change });
  if (error) throw error;
  return data as ChangeResult;
}

const refused = (result: ChangeResult) => {
  const code = result.code ?? 'error';
  return refuse(code === 'stale' ? 409 : code === 'not_found' ? 404 : 400, code, result.error ?? 'The change could not be saved');
};

type ReleaseItem = {
  id: string; text: string; textRomanUrdu: string; options: string; market: string; params: Record<string, number>;
  innings: InningsNumber; over: number; closesInSeconds: number;
};

/**
 * The questions for the overs the engine opens, worded by Gemini where it can and the templates where it
 * can't: as drafts for review, or (auto send) ready to go out.
 */
async function writeQuestions(loaded: LoadedMatch, state: MatchState, slots: Array<{ innings: InningsNumber; over: number; closesInSeconds: number }>, now: number) {
  const drafts: MatchDraft[] = [];
  for (const slot of slots) {
    const record = state.innings.find((i) => i.innings === slot.innings)!;
    const target = targetFor(slot.innings, state.balls, loaded.row.oversPerInnings);
    const score = scoreInnings(state.balls.filter((ball) => ball.innings === slot.innings), loaded.row.oversPerInnings, target);
    const questions = overQuestions({
      innings: slot.innings, over: slot.over, oversPerInnings: loaded.row.oversPerInnings,
      battingTeam: record.battingTeam, runs: score.runs, legalBalls: score.legalBalls,
    }, loaded.row.questionsPerOver);
    const worded = await aiWording({
      teams: [loaded.row.teamA, loaded.row.teamB], battingTeam: record.battingTeam, innings: slot.innings, over: slot.over,
      runs: score.runs, wickets: score.wickets, oversText: score.oversText, target,
    }, questions);
    questions.forEach((q, i) => drafts.push({
      id: generateId(), innings: slot.innings, over: slot.over, market: q.market, params: q.params, options: q.options,
      text: worded[i]?.text ?? q.text, textRomanUrdu: worded[i]?.textRomanUrdu ?? q.textRomanUrdu,
      plainText: q.text, plainTextRomanUrdu: q.textRomanUrdu, ai: worded[i] !== null,
      closesAt: new Date(now + slot.closesInSeconds * 1000).toISOString(),
    }));
  }
  return drafts;
}

const releaseItem = (draft: MatchDraft, wording: { text: string; textRomanUrdu: string }, params: Record<string, number>, closesInSeconds: number): ReleaseItem => ({
  id: draft.id, text: wording.text, textRomanUrdu: wording.textRomanUrdu, options: JSON.stringify(draft.options), market: draft.market,
  params, innings: draft.innings, over: draft.over, closesInSeconds,
});

/**
 * Applies one console event to the match, if the console saw the current `version`. Writes the questions
 * the engine asks for: out at once with auto send, otherwise as drafts for review. Returns the match as it
 * now is.
 */
export async function applyMatchEvent(matchId: string, version: number, event: MatchEvent, admin: string): Promise<MatchResult<MatchView>> {
  const loaded = await loadMatch(matchId);
  if (!loaded) return refuse(404, 'not_found', 'Match not found');
  if (loaded.settled) return refuse(409, 'settled', "This match's quiz has been settled, so the match can't change any more");
  if (loaded.row.version !== version) return refuse(409, 'stale', 'Someone else changed this match first. It has been reloaded: check it and try again.');

  const outcome = applyEvent(loaded.state, event, generateId);
  if (!outcome.ok) return refuse(400, 'invalid', outcome.error);
  const { change, state } = outcome;

  const written = await writeQuestions(loaded, state, change.release, Date.now());
  const save: Record<string, unknown> = { ...change, release: [], admin };
  if (loaded.row.autoSend) {
    const window = (draft: MatchDraft) => change.release.find((slot) => slot.innings === draft.innings && slot.over === draft.over)!.closesInSeconds;
    save.release = written.map((draft) => releaseItem(draft, draft, draft.params, window(draft)));
  }
  // A removed innings' drafts go with it
  const kept = change.removeInnings ? loaded.drafts.filter((d) => d.innings !== change.removeInnings!.innings) : loaded.drafts;
  if (!loaded.row.autoSend && written.length > 0) save.drafts = [...kept, ...written];
  else if (kept !== loaded.drafts) save.drafts = kept;

  const result = await saveChange(matchId, version, save);
  if (!result.success) return refused(result);

  const action = EVENT_ACTIONS[event.type];
  if (action) {
    await logQuizAction({ quizId: loaded.row.quizId, quizTitle: loaded.title, action, adminEmail: admin, details: { matchId, event } });
  }
  const reloaded = await loadMatch(matchId);
  return { ok: true, data: matchView(reloaded!) };
}

/**
 * A change to the drafts or the switch, made against the match as it is now. Balls keep coming while an
 * admin reviews, so a change that lost the race to one is worked out again on the new version (3 tries).
 */
async function changeDrafts(
  matchId: string,
  admin: string,
  work: (loaded: LoadedMatch, now: number) => MatchResult<{ change: Record<string, unknown>; action: QuizAction; details: Record<string, unknown> }>,
): Promise<MatchResult<MatchView>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const loaded = await loadMatch(matchId);
    if (!loaded) return refuse(404, 'not_found', 'Match not found');
    if (loaded.settled) return refuse(409, 'settled', "This match's quiz has been settled, so the match can't change any more");
    const planned = work(loaded, Date.now());
    if (!planned.ok) return planned;
    const result = await saveChange(matchId, loaded.row.version, { ...planned.data.change, admin });
    if (result.code === 'stale') continue;
    if (!result.success) return refused(result);
    await logQuizAction({
      quizId: loaded.row.quizId, quizTitle: loaded.title, action: planned.data.action, adminEmail: admin,
      details: { matchId, ...planned.data.details },
    });
    return { ok: true, data: matchView((await loadMatch(matchId))!) };
  }
  return refuse(409, 'stale', 'The match kept changing while this was saved: try again');
}

export interface DraftToSend {
  id: string;
  text: string;
  textRomanUrdu: string;
  /** A new line for a question that has one (runs, dot balls) */
  line?: number;
}

/**
 * Sends reviewed questions to players, as worded by the admin: each must still be sendable (its over not
 * started, time left) and its wording must keep its over and line (src/lib/match-wording.ts).
 */
export function sendDrafts(matchId: string, sends: DraftToSend[], admin: string): Promise<MatchResult<MatchView>> {
  return changeDrafts(matchId, admin, (loaded, now) => {
    const release: ReleaseItem[] = [];
    for (const send of sends) {
      const draft = loaded.drafts.find((d) => d.id === send.id && !d.skipped);
      if (!draft) return refuse(409, 'gone', 'That question was already sent or skipped');
      const closesAt = Date.parse(draft.closesAt);
      if (!stillSendable(loaded.state, draft, closesAt, now)) {
        return refuse(409, 'too_late', `Too late: over ${draft.over} is about to start, so its questions can't go out any more`);
      }
      const params = { ...draft.params };
      if (send.line !== undefined) {
        if (typeof params.line !== 'number') return refuse(400, 'invalid', 'This question has no line to change');
        params.line = send.line;
      }
      const wording = { text: send.text.trim(), textRomanUrdu: send.textRomanUrdu.trim() };
      const problem = wordingProblem(wording, draft.over, params);
      if (problem) return refuse(400, 'wording', problem);
      release.push(releaseItem(draft, wording, params, Math.floor((closesAt - now) / 1000)));
    }
    const sent = new Set(release.map((item) => item.id));
    const edited = release.filter((item) => {
      const draft = loaded.drafts.find((d) => d.id === item.id)!;
      return item.text !== draft.text || item.textRomanUrdu !== draft.textRomanUrdu || item.params.line !== draft.params.line;
    }).map((item) => item.id);
    return {
      ok: true,
      data: {
        change: { release, drafts: loaded.drafts.filter((d) => !sent.has(d.id)) },
        action: 'match_questions_sent',
        details: { questions: [...sent], edited },
      },
    };
  });
}

/** Keeps drafts from players: their over gets no questions. */
export function skipDrafts(matchId: string, ids: string[], admin: string): Promise<MatchResult<MatchView>> {
  return changeDrafts(matchId, admin, (loaded) => {
    const skip = new Set(ids);
    if (ids.some((id) => !loaded.drafts.some((d) => d.id === id && !d.skipped))) {
      return refuse(409, 'gone', 'That question was already sent or skipped');
    }
    return {
      ok: true,
      data: {
        change: { drafts: loaded.drafts.map((d) => (skip.has(d.id) ? { ...d, skipped: true } : d)) },
        action: 'match_questions_skipped',
        details: { questions: ids },
      },
    };
  });
}

/** Turns review off (questions go out as written) or on. Drafts already waiting stay for review. */
export function setAutoSend(matchId: string, autoSend: boolean, admin: string): Promise<MatchResult<MatchView>> {
  return changeDrafts(matchId, admin, () => ({
    ok: true,
    data: { change: { autoSend }, action: 'match_auto_send_changed', details: { autoSend } },
  }));
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
