// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { overQuestions, runsLine, YES_NO, type OverContext } from '@/lib/match-questions';
import { MARKET_NAMES } from '@/lib/match-engine';

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
      { market: 'over_runs_at_least', params: { line: 8 }, text: 'Lahore Qalandars: will over 4 go for 8 or more runs?', options: YES_NO },
      { market: 'dots_at_least', params: { line: 3 }, text: 'Will over 4 have 3 or more dot balls?', options: YES_NO },
    ]);
    expect(overQuestions(ctx({ over: 5 }), 2)[1]).toEqual({ market: 'wicket_in_over', params: {}, text: 'Will a wicket fall in over 5?', options: YES_NO });
    expect(overQuestions(ctx({ over: 6 }), 2)[1]).toEqual({ market: 'boundary_in_over', params: {}, text: 'Will there be a four or a six in over 6?', options: YES_NO });
  });

  it('gives as many as asked, all different, all markets the engine can settle', () => {
    expect(overQuestions(ctx(), 1).map((q) => q.market)).toEqual(['over_runs_at_least']);
    const three = overQuestions(ctx({ over: 7 }), 3);
    expect(new Set(three.map((q) => q.market)).size).toBe(3);
    for (const q of three) expect(MARKET_NAMES).toContain(q.market);
  });
});
