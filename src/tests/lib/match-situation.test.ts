// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { matchSituation, phaseOf, situationNumbers } from '@/lib/match-situation';
import type { Ball, Extra } from '@/lib/match-engine';

let seq = 0;
const ball = (runs: number, extra: Extra = 'none', wicket = false): Ball =>
  ({ id: `b${++seq}`, innings: 1, seq, runs, extra, extraRuns: extra === 'wide' || extra === 'no_ball' ? 1 : 0, wicket });
/** An over of six legal balls with these runs (W: a wicket, no run) */
const over = (...runs: Array<number | 'W'>) => runs.map((r) => (r === 'W' ? ball(0, 'none', true) : ball(r)));

const base = { innings: 1 as const, battingTeam: 'Lahore Qalandars', oversPerInnings: 20, target: null };

describe('phaseOf', () => {
  it('splits a T20 into powerplay 1-6, middle 7-16 and death 17-20, and a T10 into 1-3, 4-8 and 9-10', () => {
    expect([1, 6, 7, 16, 17, 20].map((o) => phaseOf(o, 20))).toEqual(['powerplay', 'powerplay', 'middle', 'middle', 'death', 'death']);
    expect([1, 3, 4, 8, 9, 10].map((o) => phaseOf(o, 10))).toEqual(['powerplay', 'powerplay', 'middle', 'middle', 'death', 'death']);
  });
});

describe('matchSituation', () => {
  it('is empty before the first over: nothing to say yet', () => {
    expect(matchSituation({ ...base, balls: [], afterOvers: -1 })).toEqual({
      innings: 1, battingTeam: 'Lahore Qalandars', oversPerInnings: 20, afterOvers: 0, runs: 0, wickets: 0, legalBalls: 0,
      runRate: null, recentRate: null, lastOver: null, chase: null, wicketsInHand: 10,
    });
  });

  it('counts only the overs it is after, so a later ball never changes its facts', () => {
    const balls = [...over(1, 4, 0, 1, 1, 0), ...over(6, 'W', 0, 0, 1, 2), ...over(4, 4)];
    const s = matchSituation({ ...base, balls, afterOvers: 2 });
    expect(s).toMatchObject({ afterOvers: 2, runs: 16, wickets: 1, legalBalls: 12, wicketsInHand: 9, lastOver: { number: 2, runs: 9, wickets: 1 } });
    // Two overs bowled: the rate says something now
    expect(s.runRate).toBe(8);
    expect(s.recentRate).toBe(8);
    // One over: no rate yet, but the over is the recent rate
    expect(matchSituation({ ...base, balls, afterOvers: 1 })).toMatchObject({ runRate: null, recentRate: 7, lastOver: { number: 1, runs: 7, wickets: 0 } });
  });

  it('takes the recent rate from the last three complete overs only, counting extras', () => {
    const balls = [
      ...over(6, 6, 6, 6, 6, 6),
      ...over(1, 1, 1, 1, 1, 1),
      ball(0, 'wide'), ...over(1, 1, 1, 1, 1, 1),
      ...over(1, 1, 1, 1, 1, 1),
    ];
    const s = matchSituation({ ...base, balls, afterOvers: 4 });
    expect(s.runs).toBe(36 + 6 + 7 + 6);
    // Overs 2-4: 19 runs in 18 legal balls
    expect(s.recentRate).toBeCloseTo(19 / 3);
  });

  it("works out a chase: runs needed and balls left, never below zero", () => {
    const balls = [...over(4, 4, 4, 4, 4, 4), ...over(1, 0)];
    expect(matchSituation({ ...base, innings: 2, balls, target: 50, afterOvers: 1 }).chase).toEqual({ target: 50, needed: 26, ballsLeft: 114 });
    expect(matchSituation({ ...base, innings: 2, balls, target: 20, afterOvers: 1 }).chase).toEqual({ target: 20, needed: 0, ballsLeft: 114 });
    expect(matchSituation({ ...base, innings: 2, oversPerInnings: 1, balls, target: 50, afterOvers: 2 }).chase).toMatchObject({ ballsLeft: 0 });
  });
});

describe('situationNumbers', () => {
  it('lists every number a question may state: the facts, the over, the line and numbers in team names', () => {
    const balls = [...over(4, 4, 4, 4, 4, 'W'), ...over(1, 1, 1, 1, 1, 1)];
    const s = matchSituation({ ...base, innings: 2, balls, target: 150, afterOvers: 2 });
    expect([...situationNumbers(s, 4, 9, ['Team 11', 'Kings'])].sort((a, b) => a - b)).toEqual(
      [0, 1, 2, 4, 6, 9, 11, 26, 108, 124, 150],
    );
    expect([...situationNumbers(matchSituation({ ...base, balls: [], afterOvers: 0 }), 1, null, [])].sort()).toEqual([0, 1, 10]);
  });
});
