import { getAdminDb, generateId, notificationDb } from '@/lib/supabase/db';
import { logQuizAction } from '@/lib/admin-action-log';
import { DEFAULT_MAX_ENTRIES } from '@/lib/quiz-entries';
import type { QuizAction } from '@/lib/admin-action-labels';
import { overCandidates, type OverQuestion, type Phrase } from '@/lib/match-questions';
import { matchSituation, type MatchSituation } from '@/lib/match-situation';
import {
  aiWording,
  geminiWords,
  wordingPlan,
  wordingProblem,
  wordingUsage,
  type AiLevel,
  type Wording,
  type WordingPlan,
  type WordingUsage,
} from '@/lib/match-wording';
import {
  applyEvent,
  ballsBefore,
  pushDue,
  reopenable,
  scoreInnings,
  splitOvers,
  stillSendable,
  targetFor,
  PUSH_BALLS,
  PENALTY_RUNS,
  type Ball,
  type EndReason,
  type Extra,
  type InningsNumber,
  type MatchEvent,
  type MatchState,
  type MatchStatus,
  type WicketKind,
} from '@/lib/match-engine';

/**
 * Match mode on the server (migration 20261029120000_match_mode): loads a match, applies the scorer
 * console's events through src/lib/match-engine.ts and apply_match_change, and builds what the console
 * shows. Admin-only: every caller has checked the admin session.
 *
 * Each over's quiz (the questions about over M, shown during over M-1) is prepared when over M-2 ends:
 * every market as a candidate, built from the match situation (src/lib/match-situation.ts) with a lead-in
 * that states it, the best ticked (src/lib/match-questions.ts). It waits as drafts (migration
 * 20261031120000_match_question_review) until it goes out:
 *   - Manual: the admin ticks the questions, then sends the quiz now, or sets the ball of over M-1 it goes
 *     out on (1 to 4), and it goes out when the scorer records that ball;
 *   - Auto (the match's autoSend): the best questions go out on ball 1, over 1's at once.
 * Unticked questions of a quiz that went out are skipped: one quiz an over.
 *
 * Gemini words a quiz after the ball that prepared it is saved (wordDrafts, run by the route after its
 * response), so the scorer never waits for it, and its answer is kept in "LiveMatch".wordings
 * (migration 20261106120000_match_quiz_automation), which a scorer's next ball can't overwrite. How much
 * it words follows the match's AI level, lowered near Google's limits (src/lib/match-wording.ts). A ball
 * corrected or undone before a waiting quiz's facts rebuilds that quiz from the corrected score.
 *
 * Players see a match once an admin takes it live (its quiz goes from draft to active): on the quiz page,
 * each over's questions pop up on the live stream like a pushed quiz (src/hooks/useMatchPush.ts, fed by
 * src/lib/match-feed.ts), in the match's language. The match is not in the ordinary quiz list.
 */

/** How players see a match's questions: Roman Urdu with English under it, or one of them */
export type QuizLanguage = 'both' | 'en' | 'ur';
export const QUIZ_LANGUAGES: readonly QuizLanguage[] = ['both', 'en', 'ur'];

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
  /** Auto: each over's best questions go out on its quiz's first ball, without the admin */
  autoSend: boolean;
  language: QuizLanguage;
  /** How much Gemini words this match's quizzes */
  aiLevel: AiLevel;
  version: number;
  createdAt: string;
}

/** One question of an over's quiz while it waits, as "LiveMatch".drafts stores it */
export interface MatchDraft {
  /** The question's id once sent */
  id: string;
  innings: InningsNumber;
  /** The over it asks about */
  over: number;
  market: string;
  params: Record<string, number>;
  options: string[];
  /** The built-in wording, lead-in included */
  text: string;
  textRomanUrdu: string;
  /** Its question and lead-in apart, which Gemini rewords */
  body: Phrase;
  lead: Phrase | null;
  /** Its place among the over's candidates, best first */
  rank: number;
  /** Ticked: goes out with the quiz */
  selected: boolean;
  /** Gemini was asked to word it: its answer lands in "LiveMatch".wordings */
  aiAsked: boolean;
  preparedAt: string;
  /** Once out, its questions close this many seconds later at the latest */
  window: number;
  /** The quiz goes out on this ball of the over before it (1 to 4), set by Auto or the admin */
  pushOn?: number;
  pushBy?: 'auto' | 'admin';
  /** The wording the admin set it to go out with */
  edit?: Wording & { line?: number };
  /** How many times a corrected ball rebuilt its quiz */
  rebuilt?: number;
  skipped?: boolean;
}

/** Gemini's answer for a draft ("LiveMatch".wordings) */
export type StoredWording = Wording | { failed: true };

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
  /** Players can see it: its quiz is active (Go live), not a draft */
  published: boolean;
  /**
   * Players who have answered, and how many may (QuizAdminSettings, 2,000 unless changed). Only read
   * when asked for (loadMatch's withPlayers): working out a change doesn't need it.
   */
  players: { entries: number; maxEntries: number } | null;
  /** Its quiz has been settled: the match can't change any more */
  settled: boolean;
  state: MatchState;
  questions: QuestionRow[];
  drafts: MatchDraft[];
  wordings: Record<string, StoredWording>;
}

type Joined<T> = T | T[] | null;
const one = <T>(value: Joined<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value);

const MATCH_COLUMNS = 'id, quizId, teamA, teamB, oversPerInnings, questionsPerOver, firstWindowSeconds, lockFallbackSeconds, status, autoSend, language, aiLevel, version, createdAt, drafts, wordings';

const NOT_READ = { data: null, error: null };

/** The match with its innings, balls and questions, or null when there is none. */
export async function loadMatch(matchId: string, now = Date.now(), withPlayers = false): Promise<LoadedMatch | null> {
  const db = getAdminDb();
  const { data, error } = await db.from('LiveMatch').select(`${MATCH_COLUMNS}, Quiz:quizId (title, status)`).eq('id', matchId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { Quiz, drafts, wordings, ...row } = data as MatchRow & {
    Quiz: Joined<{ title: string; status: string }>; drafts: MatchDraft[] | null; wordings: Record<string, StoredWording> | null;
  };
  const draftList = drafts ?? [];

  const [innings, balls, questions, settlement, settings, entries] = await Promise.all([
    db.from('MatchInnings').select('innings, battingTeam, endReason').eq('matchId', matchId).order('innings'),
    db.from('BallEvent').select('id, innings, seq, runs, extra, extraRuns, wicket, wicketKind, boundary').eq('matchId', matchId).is('undoneAt', null)
      .order('innings').order('seq'),
    db.from('Question')
      .select('id, text, textRomanUrdu, options, matchInnings, matchOver, market, marketParams, status, hasCorrectAnswer, correctOption, closesAt')
      .eq('quizId', row.quizId).not('matchInnings', 'is', null).order('matchInnings').order('matchOver').order('createdAt'),
    db.from('QuizSettlement').select('quizId', { count: 'exact', head: true }).eq('quizId', row.quizId),
    withPlayers ? db.from('QuizAdminSettings').select('maxEntries').eq('quizId', row.quizId).maybeSingle() : NOT_READ,
    withPlayers ? db.from('QuizEntryCount').select('entries').eq('quizId', row.quizId).maybeSingle() : NOT_READ,
  ]);
  for (const result of [innings, balls, questions, settlement, settings, entries]) if (result.error) throw result.error;

  const questionRows = (questions.data || []) as QuestionRow[];
  const quiz = one(Quiz);
  return {
    // Rows from before migration 20261106120000 have neither
    row: { ...row, language: row.language ?? 'both', aiLevel: row.aiLevel ?? 'full' },
    title: quiz?.title ?? `${row.teamA} vs ${row.teamB}`,
    published: quiz?.status === 'active',
    players: withPlayers ? {
      entries: (entries.data as { entries: number } | null)?.entries ?? 0,
      maxEntries: (settings.data as { maxEntries: number } | null)?.maxEntries ?? DEFAULT_MAX_ENTRIES,
    } : null,
    settled: (settlement.count ?? 0) > 0,
    questions: questionRows,
    drafts: draftList,
    wordings: wordings ?? {},
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

// ── Quizzes ───────────────────────────────────────────────────────────────────────────────────────

type Slot = { innings: InningsNumber; over: number };
const sameSlot = (a: Slot, b: Slot) => a.innings === b.innings && a.over === b.over;

/** The drafts of each over's quiz, in the order they were prepared */
function quizzesOf(drafts: MatchDraft[]): MatchDraft[][] {
  const groups: MatchDraft[][] = [];
  for (const draft of drafts) {
    const group = groups.find((g) => sameSlot(g[0], draft));
    if (group) group.push(draft);
    else groups.push([draft]);
  }
  return groups;
}

const isOpen = (group: MatchDraft[]) => group.some((d) => !d.skipped);

/** The wording a draft goes out with: the admin's, else Gemini's, else the built-in one */
function wordingOf(draft: MatchDraft, wordings: Record<string, StoredWording>): Wording & { source: 'edit' | 'ai' | 'built_in' } {
  if (draft.edit) return { text: draft.edit.text, textRomanUrdu: draft.edit.textRomanUrdu, source: 'edit' };
  const ai = wordings[draft.id];
  if (ai && !('failed' in ai)) return { text: ai.text, textRomanUrdu: ai.textRomanUrdu, source: 'ai' };
  return { text: draft.text, textRomanUrdu: draft.textRomanUrdu, source: 'built_in' };
}

/** The situation the quiz about `slot` is built from: its innings after over M-2 */
function situationFor(state: MatchState, row: MatchRow, slot: Slot): MatchSituation {
  const record = state.innings.find((i) => i.innings === slot.innings)!;
  return matchSituation({
    balls: state.balls.filter((ball) => ball.innings === slot.innings), innings: slot.innings, battingTeam: record.battingTeam,
    oversPerInnings: row.oversPerInnings, target: targetFor(slot.innings, state.balls, row.oversPerInnings), afterOvers: slot.over - 2,
  });
}

/** What the over before asked (sent, or ticked in its waiting quiz), so neighbouring overs ask different things */
function recentMarkets(state: MatchState, drafts: MatchDraft[], slot: Slot): string[] {
  const before = { innings: slot.innings, over: slot.over - 1 };
  return [
    ...state.questions.filter((q) => sameSlot(q, before)).map((q) => q.market),
    ...drafts.filter((d) => sameSlot(d, before) && d.selected && !d.skipped).map((d) => d.market),
  ];
}

/** The quiz about `slot`'s questions, from the situation: every market, the best ticked */
function candidatesFor(row: MatchRow, state: MatchState, drafts: MatchDraft[], slot: Slot): OverQuestion[] {
  return overCandidates(situationFor(state, row, slot), slot.over, recentMarkets(state, drafts, slot));
}

function newDrafts(row: MatchRow, slot: Slot, candidates: OverQuestion[], now: number, rest: Pick<MatchDraft, 'aiAsked' | 'window'> & Partial<MatchDraft>,
  selected: (q: OverQuestion, rank: number) => boolean): MatchDraft[] {
  return candidates.map((q, rank) => ({
    id: generateId(), innings: slot.innings, over: slot.over, market: q.market, params: q.params, options: q.options,
    text: q.text, textRomanUrdu: q.textRomanUrdu, body: q.body, lead: q.lead, rank, selected: selected(q, rank),
    preparedAt: new Date(now).toISOString(), ...rest,
  }));
}

/**
 * Waiting quizzes whose facts a corrected or undone ball changed, built again from the corrected score:
 * new questions (new ids, so a late Gemini answer for the old ones is dropped), the same markets ticked and
 * the same ball set; the admin's wording goes, as it states the old facts. Gemini words a quiz again only
 * the first time it is rebuilt. Returns the drafts, and the ids of the rebuilt ones.
 */
function rebuildQuizzes(row: MatchRow, state: MatchState, drafts: MatchDraft[], now: number, plan: WordingPlan) {
  const rebuilt: MatchDraft[] = [];
  const out = quizzesOf(drafts).flatMap((group) => {
    const first = group[0];
    if (!isOpen(group) || !stillSendable(state, first)) return group;
    const fresh = candidatesFor(row, state, drafts, first);
    const same = group.every((d) => {
      const q = fresh.find((c) => c.market === d.market);
      return q !== undefined && q.text === d.text && q.params.line === d.params.line;
    });
    if (same) return group;
    const times = (first.rebuilt ?? 0) + 1;
    const ticked = new Set(group.filter((d) => d.selected).map((d) => d.market));
    const next = newDrafts(row, first, fresh, now, {
      aiAsked: times === 1 && geminiWords(plan.effective, first.over), window: first.window, rebuilt: times,
      ...(first.pushOn ? { pushOn: first.pushOn, pushBy: first.pushBy } : {}),
    }, (q) => ticked.has(q.market));
    rebuilt.push(...next);
    return next;
  });
  return { drafts: out, rebuilt };
}

type ReleaseItem = {
  id: string; text: string; textRomanUrdu: string; options: string; market: string; params: Record<string, number>;
  innings: InningsNumber; over: number; closesInSeconds: number;
};

const releaseItem = (draft: MatchDraft, wording: Wording, params: Record<string, number>): ReleaseItem => ({
  id: draft.id, text: wording.text, textRomanUrdu: wording.textRomanUrdu, options: JSON.stringify(draft.options), market: draft.market,
  params, innings: draft.innings, over: draft.over, closesInSeconds: draft.window,
});

/** The quiz's ticked questions go out (`items`); the rest of it is skipped. Returns the drafts left. */
function release(drafts: MatchDraft[], group: MatchDraft[], items: ReleaseItem[]): MatchDraft[] {
  const sent = new Set(items.map((item) => item.id));
  return drafts.filter((d) => !sent.has(d.id)).map((d) => (group.includes(d) ? { ...d, skipped: true } : d));
}

/**
 * Quizzes set to go out on a ball the balls have reached (pushDue), out with their ticked questions in the
 * admin's, Gemini's or the built-in wording.
 */
function duePushes(state: MatchState, drafts: MatchDraft[], wordings: Record<string, StoredWording>) {
  let left = drafts;
  const items: ReleaseItem[] = [];
  const pushed: Array<{ over: number; ball: number; by: string; questions: string[] }> = [];
  for (const group of quizzesOf(drafts)) {
    const first = group[0];
    if (!isOpen(group) || first.pushOn === undefined || !pushDue(state, first, first.pushOn)) continue;
    const out = group.filter((d) => d.selected && !d.skipped).map((d) => releaseItem(d, wordingOf(d, wordings), { ...d.params, ...(d.edit?.line !== undefined ? { line: d.edit.line } : {}) }));
    left = release(left, group, out);
    items.push(...out);
    pushed.push({ over: first.over, ball: first.pushOn, by: first.pushBy ?? 'admin', questions: out.map((item) => item.id) });
  }
  return { drafts: left, items, pushed };
}

// ── What the console shows ────────────────────────────────────────────────────────────────────────

const EXTRA_LABEL: Record<Extra, string> = {
  none: '', wide: 'Wd', no_ball: 'Nb', no_ball_bye: 'NbB', no_ball_leg_bye: 'NbLb', bye: 'B', leg_bye: 'Lb', penalty: 'P', no_delivery: '',
};
const OUT_LABEL: Partial<Record<WicketKind, string>> = { run_out: 'RO', retired_out: 'Ret', timed_out: 'TO' };

/**
 * An entry as a scorecard writes it: 0, 4, 6, 4r (an all-run four), W, RO, Wd, 1Wd, 4Nb, 2NbB, 2Lb, 1RO, 5P
 * (penalty runs), Ret (retired out), TO (timed out)
 */
export function ballLabel(ball: Pick<Ball, 'runs' | 'extra' | 'wicket' | 'wicketKind' | 'boundary'>): string {
  if (ball.extra === 'penalty') return `${PENALTY_RUNS}P`;
  const extra = EXTRA_LABEL[ball.extra];
  // A 4 or 6 that wasn't a boundary: run, or overthrows
  const runs = ball.boundary === false && (ball.runs === 4 || ball.runs === 6) ? `${ball.runs}r` : String(ball.runs);
  if (ball.wicket) return `${ball.runs > 0 ? runs : ''}${extra}${(ball.wicketKind && OUT_LABEL[ball.wicketKind]) || 'W'}`;
  if (extra) return `${ball.runs > 0 ? runs : ''}${extra}`;
  return runs;
}

export type QuestionState = 'open' | 'closed' | 'settled' | 'void';

/** A delivery as the console shows it, with what it needs to correct it */
export interface ViewBall {
  id: string;
  label: string;
  runs: number;
  extra: Extra;
  wicket: boolean;
  wicketKind: WicketKind | null;
  boundary: boolean | null;
}

/** A question of a waiting quiz, as the console shows it */
export interface QuizQuestionView {
  id: string;
  market: string;
  options: string[];
  /** The runs or dot balls it asks about, which the admin can change */
  line: number | null;
  /** What goes out unless changed: the admin's wording, Gemini's or the built-in one */
  text: string;
  textRomanUrdu: string;
  source: 'edit' | 'ai' | 'built_in';
  /** The built-in wording and line, one click away */
  builtIn: Wording & { line: number | null };
  /** Among the best for this over */
  best: boolean;
  selected: boolean;
}

/** An over's quiz waiting to go out */
export interface QuizView {
  innings: InningsNumber;
  /** The over its questions ask about */
  over: number;
  /** The over it goes out in (`over` - 1), or null for over 1's (before the first ball) */
  during: number | null;
  /** Legal balls of `during` bowled so far; null for over 1's */
  ballsBowled: number | null;
  /** `during` has started */
  started: boolean;
  /** The ball of `during` it goes out on, and who set it */
  pushOn: number | null;
  pushBy: 'auto' | 'admin' | null;
  /** Gemini is still wording it, worded it, or the built-in wording is used */
  wording: 'pending' | 'ai' | 'built_in';
  /** A corrected ball rebuilt it */
  rebuilt: boolean;
  questions: QuizQuestionView[];
}

export interface MatchView {
  match: Omit<MatchRow, 'createdAt'> & { title: string; published: boolean };
  settled: boolean;
  players: LoadedMatch['players'];
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
  /** Quizzes waiting to go out, oldest first */
  quizzes: QuizView[];
  /** Quizzes that ran out of time unsent: their overs have no questions */
  lapsed: Slot[];
  /** How much of Gemini's limits this server has used, and what the match's AI level comes to with it */
  wording: WordingUsage & { plan: WordingPlan };
  /** The server's clock, so the console counts down to close times correctly */
  serverNow: string;
}

// Gemini answers within its 6 s timeout, after the ball's response: until then the quiz shows it is being worded
const WORDING_PENDING_MS = 20_000;

function parseOptions(options: string): string[] {
  try {
    const parsed: unknown = JSON.parse(options);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function quizView(loaded: LoadedMatch, group: MatchDraft[], now: number): QuizView {
  const first = group[0];
  const live = group.filter((d) => !d.skipped);
  const overs = splitOvers(loaded.state.balls.filter((ball) => ball.innings === first.innings));
  const questions = live.map((d): QuizQuestionView => {
    const wording = wordingOf(d, loaded.wordings);
    return {
      id: d.id, market: d.market, options: d.options,
      line: d.edit?.line ?? (typeof d.params.line === 'number' ? d.params.line : null),
      text: wording.text, textRomanUrdu: wording.textRomanUrdu, source: wording.source,
      builtIn: { text: d.text, textRomanUrdu: d.textRomanUrdu, line: typeof d.params.line === 'number' ? d.params.line : null },
      best: d.rank < loaded.row.questionsPerOver, selected: d.selected,
    };
  });
  const pending = live.some((d) => d.aiAsked && !loaded.wordings[d.id] && now - Date.parse(d.preparedAt) < WORDING_PENDING_MS);
  return {
    innings: first.innings,
    over: first.over,
    during: first.over === 1 ? null : first.over - 1,
    ballsBowled: ballsBefore(loaded.state, first),
    started: first.over > 1 && overs[first.over - 2] !== undefined,
    pushOn: first.pushOn ?? null,
    pushBy: first.pushOn === undefined ? null : first.pushBy ?? 'admin',
    wording: pending ? 'pending' : questions.some((q) => q.source === 'ai') ? 'ai' : 'built_in',
    rebuilt: (first.rebuilt ?? 0) > 0,
    questions,
  };
}

export function matchView(loaded: LoadedMatch, now = Date.now()): MatchView {
  const { row, state } = loaded;
  const canReopen = new Set(reopenable(state).map((q) => q.id));
  const { createdAt: _createdAt, ...match } = row;
  const open = quizzesOf(loaded.drafts).filter(isOpen);
  const usage = wordingUsage(process.env, now);
  return {
    match: { ...match, title: loaded.title, published: loaded.published },
    settled: loaded.settled,
    players: loaded.players,
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
          balls: over.balls.map((ball) => ({
            id: ball.id, label: ballLabel(ball), runs: ball.runs, extra: ball.extra, wicket: ball.wicket,
            wicketKind: ball.wicketKind ?? null, boundary: ball.boundary ?? null,
          })),
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
    quizzes: open.filter((group) => stillSendable(state, group[0])).map((group) => quizView(loaded, group, now)),
    lapsed: open.filter((group) => !stillSendable(state, group[0])).map((group) => ({ innings: group[0].innings, over: group[0].over })),
    wording: { ...usage, plan: wordingPlan(row.aiLevel, usage) },
    serverNow: new Date(now).toISOString(),
  };
}

// ── Changing a match ──────────────────────────────────────────────────────────────────────────────

/**
 * `background`: work to run after the response (the route hands it to Next's after()): Gemini wording the
 * quizzes the change prepared.
 */
export type MatchResult<T> = { ok: true; data: T; background?: () => Promise<void> } | { ok: false; status: number; code: string; error: string };

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

/** What apply_match_change and update_match_extras answer */
type ChangeResult = { success: boolean; code?: string; error?: string };

async function saveChange(matchId: string, version: number, change: Record<string, unknown>): Promise<ChangeResult> {
  const { data, error } = await getAdminDb().rpc('apply_match_change', { p_match_id: matchId, p_version: version, p_change: change });
  if (error) throw error;
  return data as ChangeResult;
}

/** Settings and Gemini's wording, saved without changing the match's version (update_match_extras) */
async function saveExtras(matchId: string, change: Record<string, unknown>): Promise<ChangeResult> {
  const { data, error } = await getAdminDb().rpc('update_match_extras', { p_match_id: matchId, p_change: change });
  if (error) throw error;
  return data as ChangeResult;
}

const refused = (result: ChangeResult) => {
  const code = result.code ?? 'error';
  return refuse(code === 'stale' ? 409 : code === 'not_found' ? 404 : 400, code, result.error ?? 'The change could not be saved');
};

const reload = async (matchId: string) => matchView((await loadMatch(matchId, Date.now(), true))!);

/**
 * Gemini's wording for these drafts, saved beside them ("LiveMatch".wordings). Run after the response that
 * prepared them: the scorer never waits for it. Drafts gone meanwhile (sent, skipped, rebuilt) are left out,
 * and a draft Gemini didn't word well is saved as failed, so the console stops showing it as being worded.
 * Never throws.
 */
export async function wordDrafts(matchId: string, ids: string[]): Promise<void> {
  try {
    const loaded = await loadMatch(matchId);
    if (!loaded) return;
    const wordings: Record<string, StoredWording> = {};
    for (const group of quizzesOf(loaded.drafts.filter((d) => ids.includes(d.id) && !d.skipped))) {
      const first = group[0];
      if (!stillSendable(loaded.state, first)) continue;
      const worded = await aiWording(
        { teams: [loaded.row.teamA, loaded.row.teamB], situation: situationFor(loaded.state, loaded.row, first), over: first.over },
        group.map((d) => ({ market: d.market, params: d.params, options: d.options, text: d.text, textRomanUrdu: d.textRomanUrdu, body: d.body, lead: d.lead, score: 0 })),
      );
      group.forEach((d, i) => {
        wordings[d.id] = worded[i] ?? { failed: true };
      });
    }
    if (Object.keys(wordings).length === 0) return;
    const result = await saveExtras(matchId, { wordings });
    if (!result.success) console.error('[matches] Saving Gemini\'s wording was refused:', result.error);
  } catch (error) {
    console.error('[matches] Wording a quiz failed:', error);
  }
}

const backgroundWording = (matchId: string, drafts: MatchDraft[]): (() => Promise<void>) | undefined => {
  const ids = drafts.filter((d) => d.aiAsked && !d.skipped).map((d) => d.id);
  return ids.length > 0 ? () => wordDrafts(matchId, ids) : undefined;
};

/**
 * Applies one console event to the match, if the console saw the current `version`: rebuilds waiting
 * quizzes a corrected ball changed, prepares the quizzes the engine asks for (Auto sets them to go out on
 * ball 1), and sends those set to go out on a ball this event reached. Returns the match as it now is, and
 * Gemini's wording of the new quizzes to run after the response.
 */
export async function applyMatchEvent(matchId: string, version: number, event: MatchEvent, admin: string): Promise<MatchResult<MatchView>> {
  const loaded = await loadMatch(matchId);
  if (!loaded) return refuse(404, 'not_found', 'Match not found');
  if (loaded.settled) return refuse(409, 'settled', "This match's quiz has been settled, so the match can't change any more");
  if (loaded.row.version !== version) return refuse(409, 'stale', 'Someone else changed this match first. It has been reloaded: check it and try again.');

  const outcome = applyEvent(loaded.state, event, generateId);
  if (!outcome.ok) return refuse(400, 'invalid', outcome.error);
  const { change, state } = outcome;
  const now = Date.now();
  const { row } = loaded;
  const plan = wordingPlan(row.aiLevel, wordingUsage(process.env, now));

  // A removed innings' drafts go with it
  const kept = change.removeInnings ? loaded.drafts.filter((d) => d.innings !== change.removeInnings!.innings) : loaded.drafts;
  const rebuilt = rebuildQuizzes(row, state, kept, now, plan);
  const prepared: MatchDraft[] = [];
  for (const slot of change.release) {
    prepared.push(...newDrafts(row, slot, candidatesFor(row, state, [...rebuilt.drafts, ...prepared], slot), now, {
      aiAsked: geminiWords(plan.effective, slot.over), window: slot.closesInSeconds,
      ...(row.autoSend ? { pushOn: 1, pushBy: 'auto' as const } : {}),
    }, (_q, rank) => rank < row.questionsPerOver));
  }
  const due = duePushes(state, [...rebuilt.drafts, ...prepared], loaded.wordings);

  const save: Record<string, unknown> = { ...change, release: due.items, admin };
  if (JSON.stringify(due.drafts) !== JSON.stringify(loaded.drafts)) save.drafts = due.drafts;
  const result = await saveChange(matchId, version, save);
  if (!result.success) return refused(result);

  const action = EVENT_ACTIONS[event.type];
  const log = (logged: QuizAction, details: Record<string, unknown>) =>
    logQuizAction({ quizId: row.quizId, quizTitle: loaded.title, action: logged, adminEmail: admin, details: { matchId, ...details } });
  if (action) await log(action, { event });
  for (const push of due.pushed) await log('match_questions_sent', push);

  const fresh = new Set([...rebuilt.rebuilt, ...prepared].map((d) => d.id));
  return { ok: true, data: await reload(matchId), background: backgroundWording(matchId, due.drafts.filter((d) => fresh.has(d.id))) };
}

/**
 * A change to the drafts or the settings, made against the match as it is now. Balls keep coming while an
 * admin reviews, so a change that lost the race to one is worked out again on the new version (3 tries).
 */
async function changeDrafts(
  matchId: string,
  admin: string,
  work: (loaded: LoadedMatch) => MatchResult<{ change: Record<string, unknown>; action: QuizAction; details: Record<string, unknown> }>,
): Promise<MatchResult<MatchView>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const loaded = await loadMatch(matchId);
    if (!loaded) return refuse(404, 'not_found', 'Match not found');
    if (loaded.settled) return refuse(409, 'settled', "This match's quiz has been settled, so the match can't change any more");
    const planned = work(loaded);
    if (!planned.ok) return planned;
    const result = await saveChange(matchId, loaded.row.version, { ...planned.data.change, admin });
    if (result.code === 'stale') continue;
    if (!result.success) return refused(result);
    await logQuizAction({
      quizId: loaded.row.quizId, quizTitle: loaded.title, action: planned.data.action, adminEmail: admin,
      details: { matchId, ...planned.data.details },
    });
    return { ok: true, data: await reload(matchId) };
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
 * The ticked questions of one waiting quiz, as the admin worded them: each must still be waiting, all about
 * the same over, which hasn't started (with time to answer), and each wording must keep its over and line
 * (src/lib/match-wording.ts).
 */
function readQuiz(loaded: LoadedMatch, sends: DraftToSend[]) {
  const picked: Array<{ draft: MatchDraft; wording: Wording; params: Record<string, number>; edited: boolean }> = [];
  for (const send of sends) {
    const draft = loaded.drafts.find((d) => d.id === send.id && !d.skipped);
    if (!draft) return refuse(409, 'gone', 'That question was already sent or skipped');
    const params = { ...draft.params };
    if (send.line !== undefined) {
      if (typeof params.line !== 'number') return refuse(400, 'invalid', 'This question has no line to change');
      params.line = send.line;
    }
    const wording = { text: send.text.trim(), textRomanUrdu: send.textRomanUrdu.trim() };
    const problem = wordingProblem(wording, draft.over, params);
    if (problem) return refuse(400, 'wording', problem);
    const shown = wordingOf(draft, loaded.wordings);
    picked.push({ draft, wording, params, edited: wording.text !== shown.text || wording.textRomanUrdu !== shown.textRomanUrdu || params.line !== draft.params.line });
  }
  const first = picked[0].draft;
  if (picked.some((p) => !sameSlot(p.draft, first))) return refuse(400, 'invalid', "A quiz's questions must all be about the same over");
  if (!stillSendable(loaded.state, first)) {
    return refuse(409, 'too_late', `Too late: over ${first.over} is about to start, so its quiz can't go out any more`);
  }
  const group = loaded.drafts.filter((d) => sameSlot(d, first));
  return { ok: true as const, data: { first, group, picked } };
}

/**
 * Sends a quiz now, on the ball being bowled: its ticked questions as the admin worded them. The rest of
 * its questions are skipped.
 */
export function sendDrafts(matchId: string, sends: DraftToSend[], admin: string): Promise<MatchResult<MatchView>> {
  return changeDrafts(matchId, admin, (loaded) => {
    const quiz = readQuiz(loaded, sends);
    if (!quiz.ok) return quiz;
    const items = quiz.data.picked.map((p) => releaseItem(p.draft, p.wording, p.params));
    return {
      ok: true,
      data: {
        change: { release: items, drafts: release(loaded.drafts, quiz.data.group, items) },
        action: 'match_questions_sent',
        details: { questions: items.map((item) => item.id), edited: quiz.data.picked.filter((p) => p.edited).map((p) => p.draft.id) },
      },
    };
  });
}

/**
 * Sets a quiz to go out on `ball` of the over before it (1 to 4), with the ticked questions as the admin
 * worded them: it goes out when the scorer records that ball. Already reached: it goes out now.
 */
export function queueQuiz(matchId: string, ball: number, sends: DraftToSend[], admin: string): Promise<MatchResult<MatchView>> {
  return changeDrafts(matchId, admin, (loaded) => {
    if (!(PUSH_BALLS as readonly number[]).includes(ball)) return refuse(400, 'invalid', 'Pick ball 1, 2, 3 or 4');
    const quiz = readQuiz(loaded, sends);
    if (!quiz.ok) return quiz;
    const { first, group, picked } = quiz.data;
    const chosen = new Map(picked.map((p) => [p.draft.id, p]));
    const queued = loaded.drafts.map((d): MatchDraft => {
      if (!group.includes(d)) return d;
      const p = chosen.get(d.id);
      const { edit: _edit, ...rest } = d;
      return {
        ...rest, selected: p !== undefined, pushOn: ball, pushBy: 'admin',
        ...(p ? { edit: { ...p.wording, ...(p.params.line !== d.params.line ? { line: p.params.line } : {}) } } : {}),
      };
    });
    const due = duePushes(loaded.state, queued, loaded.wordings);
    return {
      ok: true,
      data: {
        change: { release: due.items, drafts: due.drafts },
        action: due.items.length > 0 ? 'match_questions_sent' : 'match_quiz_queued',
        details: { over: first.over, ball, questions: picked.map((p) => p.draft.id) },
      },
    };
  });
}

/** Takes a quiz off the ball it was set to go out on: it waits for the admin again. */
export function unqueueQuiz(matchId: string, slot: Slot, admin: string): Promise<MatchResult<MatchView>> {
  return changeDrafts(matchId, admin, (loaded) => {
    if (!loaded.drafts.some((d) => sameSlot(d, slot) && !d.skipped && d.pushOn !== undefined)) {
      return refuse(409, 'gone', `Over ${slot.over}'s quiz isn't set to go out on a ball any more`);
    }
    const drafts = loaded.drafts.map((d) => {
      if (!sameSlot(d, slot)) return d;
      const { pushOn: _pushOn, pushBy: _pushBy, ...rest } = d;
      return rest;
    });
    return { ok: true, data: { change: { drafts }, action: 'match_quiz_unqueued', details: { over: slot.over } } };
  });
}

/** Keeps quizzes from players: their overs get no questions. */
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

/**
 * Auto (`autoSend`) or Manual. Auto sets every waiting quiz the admin hasn't set to a ball to go out on ball
 * 1 with its best questions (now, if its over has started); Manual takes those off it again, leaving the
 * ones the admin set.
 */
export function setAutoSend(matchId: string, autoSend: boolean, admin: string): Promise<MatchResult<MatchView>> {
  return changeDrafts(matchId, admin, (loaded) => {
    let drafts = loaded.drafts.map((d): MatchDraft => {
      if (d.skipped) return d;
      if (autoSend && d.pushOn === undefined) return { ...d, pushOn: 1, pushBy: 'auto', selected: d.rank < loaded.row.questionsPerOver };
      if (!autoSend && d.pushBy === 'auto') {
        const { pushOn: _pushOn, pushBy: _pushBy, ...rest } = d;
        return rest;
      }
      return d;
    });
    const due = autoSend ? duePushes(loaded.state, drafts, loaded.wordings) : { drafts, items: [] };
    drafts = due.drafts;
    return {
      ok: true,
      data: { change: { autoSend, drafts, release: due.items }, action: 'match_auto_send_changed', details: { autoSend } },
    };
  });
}

/** A setting saved without changing the match's version: the language players see, or how much Gemini words */
async function setExtra(matchId: string, change: { language: QuizLanguage } | { aiLevel: AiLevel }, action: QuizAction, admin: string): Promise<MatchResult<MatchView>> {
  const loaded = await loadMatch(matchId);
  if (!loaded) return refuse(404, 'not_found', 'Match not found');
  if (loaded.settled) return refuse(409, 'settled', "This match's quiz has been settled, so the match can't change any more");
  const result = await saveExtras(matchId, change);
  if (!result.success) return refused(result);
  const [key, to] = Object.entries(change)[0];
  await logQuizAction({
    quizId: loaded.row.quizId, quizTitle: loaded.title, action, adminEmail: admin,
    details: { matchId, from: loaded.row[key as 'language' | 'aiLevel'], to },
  });
  return { ok: true, data: await reload(matchId) };
}

/** How players see the questions: Roman Urdu with English under it, or one of them. Applies to every question at once. */
export const setLanguage = (matchId: string, language: QuizLanguage, admin: string) =>
  setExtra(matchId, { language }, 'match_language_changed', admin);

/** How much Gemini words the quizzes prepared from now on */
export const setAiLevel = (matchId: string, aiLevel: AiLevel, admin: string) =>
  setExtra(matchId, { aiLevel }, 'match_ai_level_changed', admin);

/** Where players play a match: the quiz page, where each over's questions pop up on the live stream */
export const MATCH_LINK = '/quizzes';

/**
 * Tells every player a match went live: a bell notification (and web push) that opens the quiz page, where
 * its overs pop up on the stream. Slow on a big user base, so the route runs it after its response, and
 * only for the first Go live (setPublished's `announce`).
 */
export async function announceMatch(title: string): Promise<void> {
  await notificationDb.createBroadcast({
    title: '🔴 Live match',
    message: `${title}: predict what happens in every over, right on the live stream. Free to play!`,
    type: 'quiz_deadline',
    link: MATCH_LINK,
  });
}

/**
 * Go live (`published`): the match's quiz goes from draft to active, so players see the match and can
 * answer; or back to a draft, which hides it and stops answers. Never pushedAt: the quiz-wide answering
 * window it starts would close the match (src/lib/scheduled-jobs.ts); each question closes on its own.
 *
 * `announce`: this is the match's first Go live (its History tab has none before), so players should be
 * told. A match hidden by mistake and taken live again doesn't notify twice.
 */
export async function setPublished(matchId: string, published: boolean, admin: string): Promise<MatchResult<{ view: MatchView; changed: boolean; announce: boolean }>> {
  const loaded = await loadMatch(matchId, Date.now(), true);
  if (!loaded) return refuse(404, 'not_found', 'Match not found');
  if (loaded.settled) return refuse(409, 'settled', "This match's quiz has been settled, so the match can't change any more");
  if (published && loaded.row.status === 'abandoned') return refuse(409, 'abandoned', 'Restore the match before taking it live');
  if (loaded.published === published) return { ok: true, data: { view: matchView(loaded), changed: false, announce: false } };

  const { data, error } = await getAdminDb().from('Quiz')
    .update({ status: published ? 'active' : 'draft', updatedAt: new Date().toISOString() })
    .eq('id', loaded.row.quizId).eq('status', published ? 'draft' : 'active')
    .select('id');
  if (error) throw error;
  // Its quiz was changed meanwhile (another console)
  if (!data || data.length === 0) return refuse(409, 'stale', 'The match changed meanwhile. It has been reloaded: check it and try again.');
  let announce = false;
  if (published) {
    const { data: before } = await getAdminDb().from('AdminActionLog').select('id')
      .eq('quizId', loaded.row.quizId).eq('action', 'match_published').limit(1);
    announce = !before || before.length === 0;
  }
  await logQuizAction({
    quizId: loaded.row.quizId, quizTitle: loaded.title, action: published ? 'match_published' : 'match_hidden', adminEmail: admin,
    details: { matchId },
  });
  return { ok: true, data: { view: matchView((await loadMatch(matchId, Date.now(), true))!), changed: true, announce } };
}

/** How many players may join the match (first come, first served; submit_quiz_attempt enforces it). */
export async function setMaxEntries(matchId: string, maxEntries: number, admin: string): Promise<MatchResult<MatchView>> {
  const loaded = await loadMatch(matchId, Date.now(), true);
  if (!loaded) return refuse(404, 'not_found', 'Match not found');
  if (loaded.settled) return refuse(409, 'settled', "This match's quiz has been settled, so the match can't change any more");
  const { error } = await getAdminDb().from('QuizAdminSettings')
    .upsert({ quizId: loaded.row.quizId, maxEntries, updatedAt: new Date().toISOString() }, { onConflict: 'quizId' });
  if (error) throw error;
  await logQuizAction({
    quizId: loaded.row.quizId, quizTitle: loaded.title, action: 'match_entry_limit_changed', adminEmail: admin,
    details: { matchId, from: loaded.players!.maxEntries, to: maxEntries },
  });
  return { ok: true, data: matchView((await loadMatch(matchId, Date.now(), true))!) };
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
