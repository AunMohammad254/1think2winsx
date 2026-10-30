// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { clockOffset, openOver, scoreLine, type FeedQuestion } from '@/lib/match-play';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const q = (over: Partial<FeedQuestion> = {}): FeedQuestion => ({
  id: 'q1', innings: 1, over: 3, text: 'Will a wicket fall in over 3?', textRomanUrdu: null, options: ['Yes', 'No'],
  state: 'open', closesAt: '2026-10-29T12:01:00Z', correctOption: null, ...over,
});

describe('clockOffset', () => {
  it("adds the time Cloudflare kept the copy to the server's clock", () => {
    expect(clockOffset('2026-10-29T12:00:00Z', null, NOW - 2_000)).toBe(2_000);
    expect(clockOffset('2026-10-29T12:00:00Z', '3', NOW)).toBe(3_000);
    // A missing or odd Age counts as a fresh copy
    expect(clockOffset('2026-10-29T12:00:00Z', 'soon', NOW)).toBe(0);
    expect(clockOffset('2026-10-29T12:00:00Z', '0', NOW)).toBe(0);
  });
});

describe('openOver', () => {
  it('finds the over taking answers now, and when its first question closes', () => {
    const over = openOver([
      q({ id: 'old', over: 2, state: 'settled', closesAt: '2026-10-29T11:55:00Z' }),
      q({ id: 'a' }),
      q({ id: 'b', closesAt: '2026-10-29T12:00:40Z' }),
    ], NOW)!;
    expect(over).toMatchObject({ innings: 1, over: 3, closesAtMs: Date.parse('2026-10-29T12:00:40Z') });
    expect(over.questions.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('takes the later over should two be open, and none once time is up, closed early or without a time', () => {
    const later = openOver([q({ id: 'a', over: 5 }), q({ id: 'b', innings: 2, over: 1 }), q({ id: 'c', over: 4 })], NOW)!;
    expect([later.innings, later.over]).toEqual([2, 1]);
    expect(openOver([q({ id: 'a', over: 5 }), q({ id: 'c', over: 4 })], NOW)!.over).toBe(5);
    expect(openOver([q()], Date.parse('2026-10-29T12:01:00Z'))).toBeNull();
    expect(openOver([q({ state: 'closed' }), q({ closesAt: null })], NOW)).toBeNull();
    expect(openOver([], NOW)).toBeNull();
  });
});

describe('scoreLine', () => {
  const match = { title: 'Lahore vs Karachi' } as never;
  const innings = { innings: 1 as const, battingTeam: 'Lahore', endReason: null, runs: 48, wickets: 2, oversText: '6.0', target: null, overs: [] };

  it('gives the innings being played, with the target in a chase', () => {
    expect(scoreLine({ match, innings: [innings] })).toBe('Lahore 48/2 (6.0 overs)');
    expect(scoreLine({ match, innings: [innings, { ...innings, innings: 2, battingTeam: 'Karachi', runs: 12, wickets: 0, oversText: '1.3', target: 151 }] }))
      .toBe('Karachi 12/0 (1.3 overs, target 151)');
  });

  it("names the match before an innings starts", () => {
    expect(scoreLine({ match, innings: [] })).toBe('Lahore vs Karachi');
  });
});
