// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { aiWording, wordingProblem, DEFAULT_WORDING_MODEL, MAX_QUESTION_LENGTH, type WordingContext } from '@/lib/match-wording';
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
const KEY = { MATCH_GEMINI_API_KEY: 'test-key' };

const gemini = (items: unknown, status = 200) => vi.fn(async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof items === 'string' ? items : JSON.stringify(items) }] } }] }), { status }));

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
    expect(await aiWording(CTX, both, KEY, gemini('not json') as never)).toEqual([null, null]);
    expect(await aiWording(CTX, both, KEY, gemini({ en: 'an object' }) as never)).toEqual([null, null]);
    expect(await aiWording(CTX, both, KEY, vi.fn(async () => new Response('{}')) as never)).toEqual([null, null]);
    expect(await aiWording(CTX, both, KEY, vi.fn(async () => { throw new Error('timeout'); }) as never)).toEqual([null, null]);
    // One wording for two questions, and one with nothing in it
    expect(await aiWording(CTX, both, KEY, gemini([{ en: 7 }]) as never)).toEqual([null, null]);
    expect(error).toHaveBeenCalledWith('[match-wording] Gemini wording failed, using the built-in wording:', 'Gemini answered 429');
    expect(error).toHaveBeenCalledWith('[match-wording] Gemini wording failed, using the built-in wording:', 'Gemini did not answer with a list');
  });

  it('reads the key from the environment by default', async () => {
    vi.stubEnv('MATCH_GEMINI_API_KEY', '');
    expect(await aiWording(CTX, [RUNS])).toEqual([null]);
    vi.unstubAllEnvs();
  });
});
