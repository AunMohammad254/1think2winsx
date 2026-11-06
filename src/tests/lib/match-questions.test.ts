// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  dotsLine, isSimple, joinWording, leadIn, overCandidates, romanUrduOption, runsLine, SIMPLE_LENGTH, YES_NO,
} from '@/lib/match-questions';
import { MARKET_NAMES } from '@/lib/match-engine';
import type { MatchSituation } from '@/lib/match-situation';
import { aiWordingProblem, wordingProblem } from '@/lib/match-wording';
import { situationNumbers } from '@/lib/match-situation';

const situation = (over: Partial<MatchSituation> = {}): MatchSituation => ({
  innings: 1, battingTeam: 'Lahore', oversPerInnings: 20, afterOvers: 0, runs: 0, wickets: 0, legalBalls: 0,
  runRate: null, recentRate: null, lastOver: null, chase: null, wicketsInHand: 10, ...over,
});
const markets = (qs: Array<{ market: string }>) => qs.map((q) => q.market);

describe('runsLine', () => {
  it('uses a typical over for the format until two overs are bowled', () => {
    expect(runsLine(situation())).toBe(8);
    expect(runsLine(situation({ oversPerInnings: 10 }))).toBe(9);
  });

  it("then the innings' rate blended with the last three overs', rounded and kept between 5 and 14", () => {
    expect(runsLine(situation({ runRate: 7.67, recentRate: null }))).toBe(8);
    expect(runsLine(situation({ runRate: 7, recentRate: 11 }))).toBe(9);
    expect(runsLine(situation({ runRate: 3, recentRate: 2 }))).toBe(5);
    expect(runsLine(situation({ runRate: 20, recentRate: 22 }))).toBe(14);
  });

  it('in a chase, pulls it halfway to the rate the batting side needs', () => {
    // 7.9 an over so far, 38 needed from 24 balls (9.5 an over)
    expect(runsLine(situation({ runRate: 7.9, recentRate: 7.9, chase: { target: 166, needed: 38, ballsLeft: 24 } }))).toBe(9);
    // Won already, or no balls left: the rate alone
    expect(runsLine(situation({ runRate: 7.9, recentRate: 7.9, chase: { target: 166, needed: 0, ballsLeft: 24 } }))).toBe(8);
    expect(runsLine(situation({ runRate: 7.9, recentRate: 7.9, chase: { target: 166, needed: 10, ballsLeft: 0 } }))).toBe(8);
  });
});

describe('dotsLine', () => {
  it('is 3, or 2 in the death overs', () => {
    expect([1, 10, 16, 17, 20].map((o) => dotsLine(o, 20))).toEqual([3, 3, 3, 2, 2]);
  });
});

describe('leadIn', () => {
  it('says nothing before innings 1 has an over, then the score after the overs bowled', () => {
    expect(leadIn(situation())).toBeNull();
    expect(leadIn(situation({ afterOvers: 9, runs: 87, wickets: 2 }))).toEqual({ en: 'Lahore 87/2 after 9 overs', ur: '9 overs ke baad Lahore 87/2' });
  });

  it('in a chase, the target, then the runs needed from the balls left', () => {
    expect(leadIn(situation({ innings: 2, battingTeam: 'Karachi', chase: { target: 166, needed: 166, ballsLeft: 120 } })))
      .toEqual({ en: 'Karachi chase 166', ur: 'Karachi ko 166 ka target' });
    expect(leadIn(situation({ innings: 2, battingTeam: 'Karachi', afterOvers: 16, chase: { target: 166, needed: 38, ballsLeft: 24 } }))).toEqual({
      en: 'After 16 overs, Karachi need 38 runs from 24 balls',
      ur: '16 overs ke baad Karachi ko 24 balls mein 38 runs chahiye',
    });
  });
});

describe('joinWording and isSimple', () => {
  it('puts the lead-in before the question, or starts the question with a capital', () => {
    expect(joinWording({ en: 'A', ur: 'B' }, { en: 'will it?', ur: 'kya?' })).toEqual({ text: 'A: will it?', textRomanUrdu: 'B: kya?' });
    expect(joinWording(null, { en: 'will it?', ur: 'kya?' })).toEqual({ text: 'Will it?', textRomanUrdu: 'Kya?' });
    expect(isSimple({ text: 'x'.repeat(SIMPLE_LENGTH), textRomanUrdu: 'y' })).toBe(true);
    expect(isSimple({ text: 'x', textRomanUrdu: 'y'.repeat(SIMPLE_LENGTH + 1) })).toBe(false);
  });
});

describe('overCandidates', () => {
  it('offers every market the engine can settle, Yes / No, the runs question first', () => {
    const all = overCandidates(situation(), 1);
    expect(markets(all).sort()).toEqual([...MARKET_NAMES].sort());
    expect(all[0]).toEqual({
      market: 'over_runs_at_least', params: { line: 8 }, options: YES_NO,
      text: 'Lahore: will over 1 go for 8 or more runs?', textRomanUrdu: 'Lahore: kya over 1 mein 8 ya us se zyada runs banenge?',
      body: { en: 'Lahore: will over 1 go for 8 or more runs?', ur: 'Lahore: kya over 1 mein 8 ya us se zyada runs banenge?' },
      lead: null, score: 3,
    });
    // The powerplay favours boundaries
    expect(markets(all)).toEqual(['over_runs_at_least', 'boundary_in_over', 'dots_at_least', 'wicket_in_over']);
  });

  it('states the situation first, with the team named once', () => {
    const all = overCandidates(situation({ afterOvers: 9, runs: 87, wickets: 2, runRate: 9.7, recentRate: 8 }), 11);
    const [runs, dots] = all;
    expect(runs).toMatchObject({
      text: 'Lahore 87/2 after 9 overs: will over 11 go for 9 or more runs?',
      textRomanUrdu: '9 overs ke baad Lahore 87/2: kya over 11 mein 9 ya us se zyada runs banenge?',
      lead: { en: 'Lahore 87/2 after 9 overs', ur: '9 overs ke baad Lahore 87/2' },
      body: { en: 'will over 11 go for 9 or more runs?', ur: 'kya over 11 mein 9 ya us se zyada runs banenge?' },
    });
    expect(dots).toMatchObject({ market: 'dots_at_least', params: { line: 3 }, text: 'Lahore 87/2 after 9 overs: will over 11 have 3 or more dot balls?' });
  });

  it('leaves the lead-in out when the two together would be too long to read at a glance', () => {
    const team = 'The Extremely Long Named Cricket Club of Lahore City';
    const [runs] = overCandidates(situation({ battingTeam: team, afterOvers: 9, runs: 87, wickets: 2 }), 11);
    expect(runs).toMatchObject({ lead: null, text: `${team}: will over 11 go for 8 or more runs?` });
  });

  it('follows the match: the death and a late chase, a wicket last over, and what the over before asked', () => {
    // Middle overs: dot balls before boundaries, wicket last
    expect(markets(overCandidates(situation({ afterOvers: 8 }), 10))).toEqual(['over_runs_at_least', 'dots_at_least', 'boundary_in_over', 'wicket_in_over']);
    // ...and the over after asks something else
    expect(markets(overCandidates(situation({ afterOvers: 9 }), 11, ['over_runs_at_least', 'dots_at_least']))[1]).toBe('boundary_in_over');
    // A wicket last over brings the wicket question up
    expect(markets(overCandidates(situation({ afterOvers: 8, lastOver: { number: 8, runs: 3, wickets: 1 } }), 10)).slice(0, 2))
      .toEqual(['over_runs_at_least', 'wicket_in_over']);
    // A chase running out of batters too
    expect(overCandidates(situation({ innings: 2, wicketsInHand: 3, afterOvers: 8, chase: { target: 150, needed: 80, ballsLeft: 60 } }), 10)
      .find((q) => q.market === 'wicket_in_over')!.score).toBe(3);
    // The death: runs matter most, dot balls least
    const death = overCandidates(situation({ afterOvers: 16 }), 18);
    expect(death[0]).toMatchObject({ market: 'over_runs_at_least', score: 4 });
    expect(death.find((q) => q.market === 'dots_at_least')).toMatchObject({ params: { line: 2 }, score: 1 });
    // A late chase, before the death
    expect(overCandidates(situation({ innings: 2, oversPerInnings: 50, afterOvers: 40, chase: { target: 300, needed: 60, ballsLeft: 36 } }), 42)[0].score).toBe(4);
  });

  it('words every question so it passes the checks Gemini has to pass, all through a T20 chase', () => {
    for (let over = 1; over <= 20; over++) {
      const s = situation({
        innings: 2, battingTeam: 'Karachi Kings', afterOvers: Math.max(0, over - 2), runs: 8 * Math.max(0, over - 2), wickets: 2,
        runRate: over > 3 ? 8 : null, recentRate: over > 2 ? 8 : null,
        chase: { target: 166, needed: 166 - 8 * Math.max(0, over - 2), ballsLeft: 120 - 6 * Math.max(0, over - 2) },
      });
      for (const q of overCandidates(s, over)) {
        const wording = { text: q.text, textRomanUrdu: q.textRomanUrdu };
        expect(wordingProblem(wording, over, q.params)).toBeNull();
        expect(aiWordingProblem(wording, situationNumbers(s, over, q.params.line ?? null, ['Karachi Kings', 'Lahore Qalandars']))).toBeNull();
      }
    }
  });
});

describe('romanUrduOption', () => {
  it('gives every option the questions use in Roman Urdu, and nothing for one it does not know', () => {
    expect(YES_NO.map(romanUrduOption)).toEqual(['Haan', 'Nahi']);
    expect(romanUrduOption('Maybe')).toBeNull();
  });
});
