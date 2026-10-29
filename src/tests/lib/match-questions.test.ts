// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { overQuestions, runsLine, YES_NO, type OverContext } from '@/lib/match-questions';
import { MARKET_NAMES } from '@/lib/match-engine';
import { wordingProblem } from '@/lib/match-wording';

const ctx = (over: Partial<OverContext> = {}): OverContext =>
  ({ innings: 1, over: 4, oversPerInnings: 20, battingTeam: 'Lahore Qalandars', runs: 0, legalBalls: 0, ...over });

describe('runsLine', () => {
  it('uses a typical over for the format until two overs are bowled', () => {
    expect(runsLine({ runs: 30, legalBalls: 11, oversPerInnings: 20 })).toBe(8);
    expect(runsLine({ runs: 30, legalBalls: 11, oversPerInnings: 10 })).toBe(9);
  });

  it('then the run rate so far, rounded and kept between 5 and 14', () => {
    expect(runsLine({ runs: 46, legalBalls: 36, oversPerInnings: 20 })).toBe(8); // 7.67 an over
    expect(runsLine({ runs: 6, legalBalls: 24, oversPerInnings: 20 })).toBe(5);
    expect(runsLine({ runs: 90, legalBalls: 24, oversPerInnings: 20 })).toBe(14);
  });
});

describe('overQuestions', () => {
  it('always asks about the runs first, then rotates the other markets over by over', () => {
    expect(overQuestions(ctx({ over: 4, runs: 46, legalBalls: 36 }), 2)).toEqual([
      {
        market: 'over_runs_at_least', params: { line: 8 }, options: YES_NO,
        text: 'Lahore Qalandars: will over 4 go for 8 or more runs?', textRomanUrdu: 'Lahore Qalandars: kya over 4 mein 8 ya us se zyada runs banenge?',
      },
      {
        market: 'dots_at_least', params: { line: 3 }, options: YES_NO,
        text: 'Will over 4 have 3 or more dot balls?', textRomanUrdu: 'Kya over 4 mein 3 ya zyada dot balls hongi?',
      },
    ]);
    expect(overQuestions(ctx({ over: 5 }), 2)[1]).toEqual({
      market: 'wicket_in_over', params: {}, options: YES_NO, text: 'Will a wicket fall in over 5?', textRomanUrdu: 'Kya over 5 mein koi wicket giray ga?',
    });
    expect(overQuestions(ctx({ over: 6 }), 2)[1]).toEqual({
      market: 'boundary_in_over', params: {}, options: YES_NO, text: 'Will there be a four or a six in over 6?', textRomanUrdu: 'Kya over 6 mein chauka ya chhakka lagega?',
    });
  });

  it('gives as many as asked, all different, all markets the engine can settle', () => {
    expect(overQuestions(ctx(), 1).map((q) => q.market)).toEqual(['over_runs_at_least']);
    const three = overQuestions(ctx({ over: 7 }), 3);
    expect(new Set(three.map((q) => q.market)).size).toBe(3);
    for (const q of three) expect(MARKET_NAMES).toContain(q.market);
  });

  it('words every built-in question so it passes the same check as Gemini', () => {
    for (let over = 1; over <= 20; over++) {
      for (const q of overQuestions(ctx({ over, runs: 7 * over, legalBalls: 6 * (over - 1) }), 3)) {
        expect(wordingProblem(q, over, q.params)).toBeNull();
      }
    }
  });
});
