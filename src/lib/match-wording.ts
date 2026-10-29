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
 * key, or when the call fails or takes longer than 2 s). Never throws.
 */
export async function aiWording(
  ctx: WordingContext,
  questions: OverQuestion[],
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Array<Wording | null>> {
  const none = questions.map(() => null);
  const key = env.MATCH_GEMINI_API_KEY?.trim();
  if (!key || questions.length === 0) return none;
  const model = env.MATCH_GEMINI_MODEL?.trim() || DEFAULT_WORDING_MODEL;
  const request = {
    match: { teams: ctx.teams, battingTeam: ctx.battingTeam, innings: ctx.innings, score: `${ctx.runs}/${ctx.wickets}`, overs: ctx.oversText, target: ctx.target },
    questions: questions.map((q) => ({ over: ctx.over, line: q.params.line ?? null, question: q.text })),
  };
  try {
    const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      // The key in a header, not the URL, so it never lands in a log
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(request) }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 600, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Gemini answered ${res.status}`);
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
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
  }
}
