import type { InningsNumber } from '@/lib/match-engine';
import type { OverQuestion } from '@/lib/match-questions';

/**
 * Gemini's wording for an over's questions (match mode), in English and Roman Urdu. Its own key and model
 * (MATCH_GEMINI_API_KEY, MATCH_GEMINI_MODEL), so it never shares the support chatbot's quota.
 *
 * Gemini only words a question: what it asks (the market), its line and its Yes / No options come from
 * src/lib/match-questions.ts, and the balls settle it. Every wording is checked (wordingProblem) before
 * anyone sees it, and an admin reviews it in the scorer console unless the match sends automatically. On
 * any failure, slowness or a wording that fails the check, the built-in wording is used.
 *
 * Calls stay inside the key's free tier: requests per minute, input tokens per minute and requests per day
 * (MATCH_GEMINI_RPM, MATCH_GEMINI_TPM, MATCH_GEMINI_RPD; Google shows a project's limits in AI Studio and
 * doesn't publish them). A call that would go past one isn't made, and when Google refuses one anyway
 * (429), none are until its limit resets. Either way that over gets the built-in wording. The counts are
 * this server process's: a restart starts them again, which a 429 pause then catches.
 */

export interface Wording {
  text: string;
  textRomanUrdu: string;
}

export interface WordingContext {
  teams: [string, string];
  battingTeam: string;
  innings: InningsNumber;
  /** The over the questions are about */
  over: number;
  runs: number;
  wickets: number;
  oversText: string;
  target: number | null;
}

export const DEFAULT_WORDING_MODEL = 'gemini-3.1-flash-lite';

/** How much Gemini may be asked: per minute (requests, input tokens) and per day (requests) */
export interface WordingLimits {
  rpm: number;
  tpm: number;
  rpd: number;
}
// A little under the free tier of the default model (Gemini 3.1 Flash Lite: 15 requests and 250K input
// tokens a minute, 500 requests a day, in AI Studio on 2026-10-30). A T20 match takes about 40 requests.
// Google changes free tiers without notice: check AI Studio's Rate limit page and set the env to match.
export const DEFAULT_WORDING_LIMITS: WordingLimits = { rpm: 12, tpm: 200_000, rpd: 400 };
const MINUTE_MS = 60_000;
// When a 429 doesn't say how long to wait
const DEFAULT_PAUSE_MS = 60_000;
export const MAX_QUESTION_LENGTH = 160;
// The scorer is waiting on this when a ball opens the next over's questions
const TIMEOUT_MS = 2_000;
// Free entry, prizes for predictions: never worded like a bet
const BETTING = /\b(bet|bets|betting|odds|stakes?|wagers?|gambl\w*|jua|satta)\b/i;
const LINK = /https?:\/\/|www\./i;

const SYSTEM = `You word live cricket prediction questions for 1Think2Win, a free sports quiz in Pakistan.
Each question asks about an over that has not been bowled yet, and its answer is Yes or No.
For each question, write it again twice: "en" in natural English, and "ur" in Roman Urdu (Urdu written in the
Latin alphabet, the way Pakistani fans text, e.g. "Kya over 7 mein chauka lagega?").
Keep the meaning exactly: the same over number written as digits, the same number of runs or dot balls written
as digits ("or more" stays "or more"), still a Yes / No question.
You may use the batting team's name and the match situation to make it lively. Add no facts, no player names,
no predictions of your own, and nothing about money, betting or odds.
One short sentence each, at most 120 characters, ending with a question mark.
Answer with a JSON list, one {"en", "ur"} object per question, in the order given.`;

const SCHEMA = {
  type: 'ARRAY',
  items: { type: 'OBJECT', properties: { en: { type: 'STRING' }, ur: { type: 'STRING' } }, required: ['en', 'ur'] },
};

const positive = (value: string | undefined, fallback: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

export function wordingLimits(env: Record<string, string | undefined> = process.env): WordingLimits {
  return {
    rpm: positive(env.MATCH_GEMINI_RPM, DEFAULT_WORDING_LIMITS.rpm),
    tpm: positive(env.MATCH_GEMINI_TPM, DEFAULT_WORDING_LIMITS.tpm),
    rpd: positive(env.MATCH_GEMINI_RPD, DEFAULT_WORDING_LIMITS.rpd),
  };
}

/** Google's day, as "2026-10-30": requests per day reset at midnight Pacific time */
export const pacificDay = (now: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** A rough count of the tokens in a text (about 4 characters each), for checking a call before it is made */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

interface Usage {
  day: string;
  /** Requests made today */
  requests: number;
  /** The last minute's requests and their input tokens */
  recent: Array<{ at: number; tokens: number }>;
  peakRequestsPerMinute: number;
  peakTokensPerMinute: number;
  /** Google refused with 429: no calls before then */
  pausedUntil: number;
  /** Google's daily limit refused one: no calls until its day ends */
  pausedForDay: boolean;
}

let usage: Usage = { day: '', requests: 0, recent: [], peakRequestsPerMinute: 0, peakTokensPerMinute: 0, pausedUntil: 0, pausedForDay: false };

/** The usage as of `now`: a new Pacific day starts the day's counts again, and the minute keeps only its own */
function usageAt(now: number): Usage {
  const day = pacificDay(now);
  if (usage.day !== day) usage = { ...usage, day, requests: 0, peakRequestsPerMinute: 0, peakTokensPerMinute: 0, pausedForDay: false };
  usage.recent = usage.recent.filter((r) => now - r.at < MINUTE_MS);
  return usage;
}

const minuteTokens = (u: Usage) => u.recent.reduce((sum, r) => sum + r.tokens, 0);

function notePeaks(u: Usage) {
  u.peakRequestsPerMinute = Math.max(u.peakRequestsPerMinute, u.recent.length);
  u.peakTokensPerMinute = Math.max(u.peakTokensPerMinute, minuteTokens(u));
}

/** Why a call with `tokens` input tokens can't be made now, or null when it can */
function overLimit(u: Usage, limits: WordingLimits, tokens: number, now: number): string | null {
  if (u.pausedForDay) return "Google's daily limit was reached; it resets at midnight Pacific time";
  if (u.pausedUntil > now) return `Google asked to wait until ${new Date(u.pausedUntil).toISOString()}`;
  if (u.requests >= limits.rpd) return `${limits.rpd} requests today (MATCH_GEMINI_RPD)`;
  if (u.recent.length >= limits.rpm) return `${limits.rpm} requests this minute (MATCH_GEMINI_RPM)`;
  if (minuteTokens(u) + tokens > limits.tpm) return `${limits.tpm} input tokens this minute (MATCH_GEMINI_TPM)`;
  return null;
}

/** A 429: wait as long as Google says, or for its day to end when the daily limit refused it */
function pauseAfter(u: Usage, body: string, now: number) {
  if (/PerDay/i.test(body)) {
    u.pausedForDay = true;
    return;
  }
  const seconds = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1];
  u.pausedUntil = now + (seconds ? Math.ceil(Number(seconds) * 1000) : DEFAULT_PAUSE_MS);
}

/** What the scorer console shows: how much of each limit has been used */
export interface WordingUsage {
  /** A key is set: Gemini words questions */
  on: boolean;
  model: string;
  limits: WordingLimits;
  thisMinute: { requests: number; tokens: number };
  today: { requests: number; peakRequestsPerMinute: number; peakTokensPerMinute: number };
  /** Google refused a call: the built-in wording is used until then (ISO time), or until its day ends */
  pausedUntil: string | null;
  pausedForDay: boolean;
}

export function wordingUsage(env: Record<string, string | undefined> = process.env, now = Date.now()): WordingUsage {
  const u = usageAt(now);
  return {
    on: !!env.MATCH_GEMINI_API_KEY?.trim(),
    model: env.MATCH_GEMINI_MODEL?.trim() || DEFAULT_WORDING_MODEL,
    limits: wordingLimits(env),
    thisMinute: { requests: u.recent.length, tokens: minuteTokens(u) },
    today: { requests: u.requests, peakRequestsPerMinute: u.peakRequestsPerMinute, peakTokensPerMinute: u.peakTokensPerMinute },
    pausedUntil: u.pausedUntil > now ? new Date(u.pausedUntil).toISOString() : null,
    pausedForDay: u.pausedForDay,
  };
}

export function __resetWordingUsageForTests(): void {
  usage = { day: '', requests: 0, recent: [], peakRequestsPerMinute: 0, peakTokensPerMinute: 0, pausedUntil: 0, pausedForDay: false };
}

/** Why a wording can't go out for a question about `over` with `params`, or null when it can. */
export function wordingProblem(wording: Wording, over: number, params: Record<string, unknown>): string | null {
  const versions: Array<[string, string]> = [['English', wording.text], ['Roman Urdu', wording.textRomanUrdu]];
  for (const [label, value] of versions) {
    const text = value.trim();
    if (!text) return `The ${label} wording is empty`;
    if (text.length > MAX_QUESTION_LENGTH) return `The ${label} wording is longer than ${MAX_QUESTION_LENGTH} characters`;
    if (!new RegExp(`\\b${over}\\b`).test(text)) return `The ${label} wording must say which over it is about (${over})`;
    if (typeof params.line === 'number' && !new RegExp(`\\b${params.line}\\b`).test(text)) {
      return `The ${label} wording must keep the line (${params.line}): change the line with its number box`;
    }
    if (LINK.test(text)) return `The ${label} wording can't contain a link`;
    if (BETTING.test(text)) return `The ${label} wording can't talk about betting`;
  }
  return null;
}

/**
 * Gemini's wording for each question, or null for one it didn't word well (and for all of them without a
 * key, when the call would go past a limit, or when it fails or takes longer than 2 s). Never throws.
 */
export async function aiWording(
  ctx: WordingContext,
  questions: OverQuestion[],
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<Array<Wording | null>> {
  const none = questions.map(() => null);
  const key = env.MATCH_GEMINI_API_KEY?.trim();
  if (!key || questions.length === 0) return none;
  const model = env.MATCH_GEMINI_MODEL?.trim() || DEFAULT_WORDING_MODEL;
  const request = {
    match: { teams: ctx.teams, battingTeam: ctx.battingTeam, innings: ctx.innings, score: `${ctx.runs}/${ctx.wickets}`, overs: ctx.oversText, target: ctx.target },
    questions: questions.map((q) => ({ over: ctx.over, line: q.params.line ?? null, question: q.text })),
  };
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(request) }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 600, responseMimeType: 'application/json', responseSchema: SCHEMA },
  });

  const u = usageAt(now);
  const tokens = estimateTokens(body);
  const limited = overLimit(u, wordingLimits(env), tokens, now);
  if (limited) {
    console.warn(`[match-wording] Gemini not asked, using the built-in wording: ${limited}`);
    return none;
  }
  // Counted before the answer: Google counts a request that times out here too
  const call = { at: now, tokens };
  u.requests += 1;
  u.recent.push(call);

  try {
    const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      // The key in a header, not the URL, so it never lands in a log
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) pauseAfter(u, await res.text().catch(() => ''), now);
    if (!res.ok) throw new Error(`Gemini answered ${res.status}`);
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number };
    };
    // Google's own count, for the minute's tokens
    if (typeof data.usageMetadata?.promptTokenCount === 'number') call.tokens = data.usageMetadata.promptTokenCount;
    const parsed: unknown = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
    if (!Array.isArray(parsed)) throw new Error('Gemini did not answer with a list');
    return questions.map((q, i) => {
      const item = parsed[i] as { en?: unknown; ur?: unknown } | undefined;
      const wording = { text: String(item?.en ?? '').trim(), textRomanUrdu: String(item?.ur ?? '').trim() };
      return wordingProblem(wording, ctx.over, q.params) === null ? wording : null;
    });
  } catch (error) {
    console.error('[match-wording] Gemini wording failed, using the built-in wording:', error instanceof Error ? error.message : error);
    return none;
  } finally {
    // Once the call's tokens are known (Google's count, or the estimate)
    notePeaks(u);
  }
}
