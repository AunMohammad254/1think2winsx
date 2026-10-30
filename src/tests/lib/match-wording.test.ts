// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  aiWording, wordingProblem, wordingLimits, wordingUsage, pacificDay, estimateTokens, __resetWordingUsageForTests,
  DEFAULT_WORDING_MODEL, DEFAULT_WORDING_LIMITS, MAX_QUESTION_LENGTH, type WordingContext,
} from '@/lib/match-wording';
import type { OverQuestion } from '@/lib/match-questions';

const CTX: WordingContext = {
  teams: ['Lahore Qalandars', 'Karachi Kings'], battingTeam: 'Lahore Qalandars', innings: 1, over: 7, runs: 48, wickets: 2, oversText: '5.1', target: null,
};
const RUNS: OverQuestion = {
  market: 'over_runs_at_least', params: { line: 9 }, options: ['Yes', 'No'],
  text: 'Lahore Qalandars: will over 7 go for 9 or more runs?', textRomanUrdu: 'Lahore Qalandars: kya over 7 mein 9 ya us se zyada runs banenge?',
};
const WICKET: OverQuestion = {
  market: 'wicket_in_over', params: {}, options: ['Yes', 'No'],
  text: 'Will a wicket fall in over 7?', textRomanUrdu: 'Kya over 7 mein koi wicket giray ga?',
};
// Room for every call a test makes; the limits have tests of their own
const KEY = { MATCH_GEMINI_API_KEY: 'test-key', MATCH_GEMINI_RPM: '100' };

const gemini = (items: unknown, status = 200) => vi.fn(async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof items === 'string' ? items : JSON.stringify(items) }] } }] }), { status }));

beforeEach(() => __resetWordingUsageForTests());
afterEach(() => vi.restoreAllMocks());

describe('wordingProblem', () => {
  const ok = { text: 'Big over coming? Will over 7 go for 9 or more?', textRomanUrdu: 'Kya over 7 mein 9 ya zyada runs banenge?' };

  it('passes a wording that keeps the over and the line', () => {
    expect(wordingProblem(ok, 7, { line: 9 })).toBeNull();
    expect(wordingProblem({ text: 'Wicket in over 12?', textRomanUrdu: 'Over 12 mein wicket?' }, 12, {})).toBeNull();
  });

  it('says what is wrong, in either language', () => {
    expect(wordingProblem({ ...ok, text: '  ' }, 7, { line: 9 })).toBe('The English wording is empty');
    expect(wordingProblem({ ...ok, textRomanUrdu: 'x'.repeat(MAX_QUESTION_LENGTH + 1) }, 7, { line: 9 })).toBe(`The Roman Urdu wording is longer than ${MAX_QUESTION_LENGTH} characters`);
    // 17 isn't 7: the over has to be its own number
    expect(wordingProblem({ ...ok, text: 'Will over 17 go for 9 or more?' }, 7, { line: 9 })).toBe('The English wording must say which over it is about (7)');
    expect(wordingProblem({ ...ok, textRomanUrdu: 'Kya over 7 mein 10 runs banenge?' }, 7, { line: 9 }))
      .toBe('The Roman Urdu wording must keep the line (9): change the line with its number box');
    expect(wordingProblem({ ...ok, text: 'Over 7 for 9? See www.example.com' }, 7, { line: 9 })).toBe("The English wording can't contain a link");
    expect(wordingProblem({ ...ok, text: 'Place your bet: over 7 for 9 or more?' }, 7, { line: 9 })).toBe("The English wording can't talk about betting");
    expect(wordingProblem({ ...ok, textRomanUrdu: 'Over 7 mein 9 runs? Satta lagao' }, 7, { line: 9 })).toBe("The Roman Urdu wording can't talk about betting");
  });
});

describe('aiWording', () => {
  it('asks Gemini once for the whole over, with its own key in a header, and checks every wording', async () => {
    const fetcher = gemini([
      { en: 'Lahore need a big one: will over 7 go for 9 or more runs?', ur: 'Kya over 7 mein 9 ya zyada runs aayenge?' },
      { en: 'Will a wicket fall in over 17?', ur: 'Kya over 7 mein wicket giray ga?' },
    ]);
    const result = await aiWording(CTX, [RUNS, WICKET], KEY, fetcher as never);
    expect(result).toEqual([
      { text: 'Lahore need a big one: will over 7 go for 9 or more runs?', textRomanUrdu: 'Kya over 7 mein 9 ya zyada runs aayenge?' },
      // The wrong over: not used
      null,
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_WORDING_MODEL}:generateContent`);
    expect(url).not.toContain('test-key');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': 'test-key' });
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json' });
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual({
      match: { teams: ['Lahore Qalandars', 'Karachi Kings'], battingTeam: 'Lahore Qalandars', innings: 1, score: '48/2', overs: '5.1', target: null },
      questions: [{ over: 7, line: 9, question: RUNS.text }, { over: 7, line: null, question: WICKET.text }],
    });
    expect(body.system_instruction.parts[0].text).toMatch(/nothing about money, betting or odds/);
  });

  it('uses the model it is told to', async () => {
    const fetcher = gemini([]);
    await aiWording(CTX, [WICKET], { ...KEY, MATCH_GEMINI_MODEL: 'gemini-2.5-flash' }, fetcher as never);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toContain('/models/gemini-2.5-flash:generateContent');
  });

  it('asks nothing without a key or questions', async () => {
    const fetcher = gemini([]);
    expect(await aiWording(CTX, [RUNS], { MATCH_GEMINI_API_KEY: ' ' }, fetcher as never)).toEqual([null]);
    expect(await aiWording(CTX, [], KEY, fetcher as never)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back to the built-in wording when Gemini fails, answers oddly or says too little', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const both = [RUNS, WICKET];
    expect(await aiWording(CTX, both, KEY, gemini([], 429) as never)).toEqual([null, null]);
    // A 429 pauses Gemini (tested below): start again for the other failures
    __resetWordingUsageForTests();
    expect(await aiWording(CTX, both, KEY, gemini('not json') as never)).toEqual([null, null]);
    expect(await aiWording(CTX, both, KEY, gemini({ en: 'an object' }) as never)).toEqual([null, null]);
    expect(await aiWording(CTX, both, KEY, vi.fn(async () => new Response('{}')) as never)).toEqual([null, null]);
    expect(await aiWording(CTX, both, KEY, vi.fn(async () => { throw new Error('timeout'); }) as never)).toEqual([null, null]);
    // One wording for two questions, and one with nothing in it
    expect(await aiWording(CTX, both, KEY, gemini([{ en: 7 }]) as never)).toEqual([null, null]);
    expect(error).toHaveBeenCalledWith('[match-wording] Gemini wording failed, using the built-in wording:', 'Gemini answered 429');
    expect(error).toHaveBeenCalledWith('[match-wording] Gemini wording failed, using the built-in wording:', 'Gemini did not answer with a list');
    // Something thrown that isn't an Error is logged as it is
    expect(await aiWording(CTX, both, KEY, vi.fn(async () => { throw 'socket hang up'; }) as never)).toEqual([null, null]);
    expect(error).toHaveBeenLastCalledWith('[match-wording] Gemini wording failed, using the built-in wording:', 'socket hang up');
  });

  it('reads the key from the environment by default', async () => {
    vi.stubEnv('MATCH_GEMINI_API_KEY', '');
    expect(await aiWording(CTX, [RUNS])).toEqual([null]);
    vi.unstubAllEnvs();
  });
});

describe('Gemini limits', () => {
  const NOW = Date.parse('2026-10-30T10:00:00Z');
  const answer = (promptTokenCount?: number) => vi.fn(async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '[]' }] } }],
    ...(promptTokenCount === undefined ? {} : { usageMetadata: { promptTokenCount } }),
  })));
  const ask = (env: Record<string, string>, fetcher: unknown, now: number) => aiWording(CTX, [WICKET], { MATCH_GEMINI_API_KEY: 'k', ...env }, fetcher as never, now);
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reads the limits from the environment, with safe defaults for anything missing or odd', () => {
    expect(wordingLimits({})).toEqual(DEFAULT_WORDING_LIMITS);
    // A little under Gemini 3.1 Flash Lite's free tier (15, 250K, 500)
    expect(DEFAULT_WORDING_LIMITS).toEqual({ rpm: 12, tpm: 200_000, rpd: 400 });
    expect(wordingLimits({ MATCH_GEMINI_RPM: '12', MATCH_GEMINI_TPM: '200000', MATCH_GEMINI_RPD: '400' })).toEqual({ rpm: 12, tpm: 200_000, rpd: 400 });
    expect(wordingLimits({ MATCH_GEMINI_RPM: '0', MATCH_GEMINI_TPM: '-5', MATCH_GEMINI_RPD: 'lots' })).toEqual(DEFAULT_WORDING_LIMITS);
    expect(wordingLimits({ MATCH_GEMINI_RPM: '2.5' }).rpm).toBe(12);
  });

  it("counts days as Google does, in Pacific time, and tokens roughly", () => {
    // 10:00 UTC is 03:00 in Los Angeles; 06:00 UTC is still the day before there
    expect(pacificDay(NOW)).toBe('2026-10-30');
    expect(pacificDay(Date.parse('2026-10-30T06:00:00Z'))).toBe('2026-10-29');
    expect(estimateTokens('12345678')).toBe(2);
    expect(estimateTokens('123456789')).toBe(3);
  });

  it('asks no more often than the requests per minute allow, then again once the minute has passed', async () => {
    const fetcher = answer();
    await ask({ MATCH_GEMINI_RPM: '2' }, fetcher, NOW);
    await ask({ MATCH_GEMINI_RPM: '2' }, fetcher, NOW + 1_000);
    expect(await ask({ MATCH_GEMINI_RPM: '2' }, fetcher, NOW + 59_000)).toEqual([null]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith('[match-wording] Gemini not asked, using the built-in wording: 2 requests this minute (MATCH_GEMINI_RPM)');
    await ask({ MATCH_GEMINI_RPM: '2' }, fetcher, NOW + 60_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("keeps the minute's input tokens under the limit, counting Google's own number once it answers", async () => {
    // Too big to send at all
    const fetcher = answer(5_000);
    expect(await ask({ MATCH_GEMINI_TPM: '10' }, fetcher, NOW)).toEqual([null]);
    expect(console.warn).toHaveBeenCalledWith('[match-wording] Gemini not asked, using the built-in wording: 10 input tokens this minute (MATCH_GEMINI_TPM)');
    expect(fetcher).not.toHaveBeenCalled();
    // The first call used 5,000 by Google's count: a second one (over 100 more, estimated) would go past 5,100
    await ask({ MATCH_GEMINI_TPM: '5100' }, fetcher, NOW);
    expect(await ask({ MATCH_GEMINI_TPM: '5100' }, fetcher, NOW + 1_000)).toEqual([null]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wordingUsage({ MATCH_GEMINI_API_KEY: 'k' }, NOW + 1_000).thisMinute).toEqual({ requests: 1, tokens: 5_000 });
  });

  it('asks no more than the requests per day allow, until the Pacific day ends', async () => {
    const fetcher = answer();
    await ask({ MATCH_GEMINI_RPD: '2' }, fetcher, NOW);
    await ask({ MATCH_GEMINI_RPD: '2' }, fetcher, NOW + 120_000);
    expect(await ask({ MATCH_GEMINI_RPD: '2' }, fetcher, NOW + 240_000)).toEqual([null]);
    expect(console.warn).toHaveBeenCalledWith('[match-wording] Gemini not asked, using the built-in wording: 2 requests today (MATCH_GEMINI_RPD)');
    // Midnight in Los Angeles is 07:00 UTC
    await ask({ MATCH_GEMINI_RPD: '2' }, fetcher, Date.parse('2026-10-31T07:00:00Z'));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('stops asking after Google refuses, for as long as it says, a minute when it says nothing, and the day for its daily limit', async () => {
    const refused = (body: string) => vi.fn(async () => new Response(body, { status: 429 }));
    const ok = answer();
    await ask({}, refused('{"error":{"details":[{"retryDelay": "7.5s"}]}}'), NOW);
    expect(wordingUsage({ MATCH_GEMINI_API_KEY: 'k' }, NOW).pausedUntil).toBe(new Date(NOW + 7_500).toISOString());
    expect(await ask({}, ok, NOW + 7_000)).toEqual([null]);
    expect(console.warn).toHaveBeenCalledWith(`[match-wording] Gemini not asked, using the built-in wording: Google asked to wait until ${new Date(NOW + 7_500).toISOString()}`);
    await ask({}, ok, NOW + 7_500);
    expect(ok).toHaveBeenCalledTimes(1);

    // No delay given, or a body that can't be read: a minute
    await ask({}, refused('{}'), NOW + 10_000);
    expect(wordingUsage({}, NOW + 10_000).pausedUntil).toBe(new Date(NOW + 70_000).toISOString());
    __resetWordingUsageForTests();
    const unreadable = vi.fn(async () => ({ ok: false, status: 429, text: async () => { throw new Error('reset'); } }));
    await ask({}, unreadable, NOW);
    expect(wordingUsage({}, NOW).pausedUntil).toBe(new Date(NOW + 60_000).toISOString());

    __resetWordingUsageForTests();
    await ask({}, refused('{"error":{"details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}'), NOW);
    expect(wordingUsage({}, NOW + 3_600_000)).toMatchObject({ pausedForDay: true, pausedUntil: null });
    expect(await ask({}, ok, NOW + 3_600_000)).toEqual([null]);
    expect(console.warn).toHaveBeenLastCalledWith("[match-wording] Gemini not asked, using the built-in wording: Google's daily limit was reached; it resets at midnight Pacific time");
    await ask({}, ok, Date.parse('2026-10-31T07:00:00Z'));
    expect(ok).toHaveBeenCalledTimes(2);
  });

  it("reports what the console shows: on or off, the limits, this minute's use and the day's peaks", async () => {
    expect(wordingUsage({}, NOW)).toEqual({
      on: false, model: DEFAULT_WORDING_MODEL, limits: DEFAULT_WORDING_LIMITS,
      thisMinute: { requests: 0, tokens: 0 }, today: { requests: 0, peakRequestsPerMinute: 0, peakTokensPerMinute: 0 },
      pausedUntil: null, pausedForDay: false,
    });
    const env = { MATCH_GEMINI_API_KEY: 'k', MATCH_GEMINI_MODEL: 'gemini-x', MATCH_GEMINI_RPM: '9' };
    await aiWording(CTX, [WICKET], env, answer(800) as never, NOW);
    await aiWording(CTX, [WICKET], env, answer(700) as never, NOW + 1_000);
    // A failed call still counts, with its estimated tokens
    await aiWording(CTX, [WICKET], env, vi.fn(async () => { throw new Error('timeout'); }) as never, NOW + 120_000);
    const usage = wordingUsage(env, NOW + 120_000);
    expect(usage).toMatchObject({ on: true, model: 'gemini-x', limits: { rpm: 9, tpm: 200_000, rpd: 400 } });
    expect(usage.today).toEqual({ requests: 3, peakRequestsPerMinute: 2, peakTokensPerMinute: 1_500 });
    expect(usage.thisMinute.requests).toBe(1);
    expect(usage.thisMinute.tokens).toBeGreaterThan(100);
    // A new day starts the day's counts and peaks again
    expect(wordingUsage(env, Date.parse('2026-10-31T08:00:00Z')).today).toEqual({ requests: 0, peakRequestsPerMinute: 0, peakTokensPerMinute: 0 });
  });
});
