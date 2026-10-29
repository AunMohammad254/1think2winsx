// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { byOver, clock, clockOffset, closesAt, isOpen, tally, type FeedQuestion } from '@/lib/match-play';

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

describe('isOpen', () => {
  it('takes answers until it closes, whatever an older copy of the feed says', () => {
    expect(isOpen(q(), NOW)).toBe(true);
    expect(isOpen(q(), Date.parse('2026-10-29T12:01:00Z'))).toBe(false);
    expect(isOpen(q({ closesAt: null }), NOW)).toBe(true);
    expect(isOpen(q({ state: 'closed' }), NOW)).toBe(false);
  });
});

describe('byOver and closesAt', () => {
  it('groups the questions by innings and over, and finds when a group closes', () => {
    const groups = byOver([
      q({ id: 'a', over: 2 }), q({ id: 'b', over: 2, closesAt: '2026-10-29T11:59:00Z' }),
      q({ id: 'c', over: 3, closesAt: null }), q({ id: 'd', innings: 2, over: 3 }),
    ]);
    expect(groups.map((g) => [g.key, g.questions.map((x) => x.id)])).toEqual([['1.2', ['a', 'b']], ['1.3', ['c']], ['2.3', ['d']]]);
    expect(closesAt(groups[0], NOW - 120_000)).toBe(Date.parse('2026-10-29T11:59:00Z'));
    // Only the questions still open count
    expect(closesAt(groups[0], NOW)).toBe(Date.parse('2026-10-29T12:01:00Z'));
    expect(closesAt(groups[1], NOW)).toBeNull();
  });
});

describe('tally', () => {
  it('counts right answers among the settled questions the player answered', () => {
    const questions = [
      q({ id: 'a', state: 'settled', correctOption: 0 }), q({ id: 'b', state: 'settled', correctOption: 1 }),
      q({ id: 'c', state: 'settled', correctOption: 1 }), q({ id: 'd', state: 'closed' }),
    ];
    expect(tally(questions, { a: 0, b: 0, d: 1 })).toEqual({ right: 1, settled: 2 });
    expect(tally(questions, {})).toEqual({ right: 0, settled: 0 });
  });
});

describe('clock', () => {
  it('shows minutes and seconds, never below zero', () => {
    expect([clock(83_000), clock(59_001), clock(-5)]).toEqual(['1:23', '1:00', '0:00']);
  });
});
