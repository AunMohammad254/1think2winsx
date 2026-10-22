// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { LiveQuiz, LiveSnapshot } from '@/lib/live-catalog';
import { toLandingQuizzes, nextQuizStart, formatCountdown, MAX_LANDING_QUIZZES } from '@/lib/landing-live';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const MIN = 60_000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const quiz = (id: string, over: Partial<LiveQuiz> = {}): LiveQuiz => ({
  id, title: `Quiz ${id}`, description: '', duration: 10, passingScore: 70, status: 'active', questionCount: 5,
  totalAttempts: 0, entriesClosed: false, pushedAt: null, startsAt: null, announcedAt: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  prizeName: null, isBumperPrize: false, accessPrice: 0, ...over,
});
const snap = (quizzes: LiveQuiz[], walletEnabled = false): LiveSnapshot => ({ version: 'v', quizzes, walletEnabled });

describe('toLandingQuizzes', () => {
  it('lists live, then always-open, then upcoming quizzes, and drops what a visitor cannot join', () => {
    const list = toLandingQuizzes(snap([
      quiz('later', { status: 'upcoming', startsAt: at(120 * MIN) }),
      quiz('open'),
      quiz('closing-late', { pushedAt: at(-2 * MIN) }),
      quiz('no-time', { status: 'upcoming' }),
      quiz('closed', { pushedAt: at(-30 * MIN) }),
      quiz('paused', { status: 'paused', pushedAt: at(-2 * MIN) }),
      quiz('empty', { questionCount: 0 }),
      quiz('soon', { status: 'upcoming', startsAt: at(5 * MIN), questionCount: 0 }),
      quiz('closing-soon', { pushedAt: at(-8 * MIN) }),
    ]), NOW);

    expect(list.map((q) => [q.id, q.state])).toEqual([
      ['closing-soon', 'live'], ['closing-late', 'live'], ['open', 'open'], ['soon', 'upcoming'], ['later', 'upcoming'],
    ]);
    expect(list[0]).toMatchObject({ endsAtMs: NOW + 2 * MIN, startsAtMs: null });
    expect(list[2]).toMatchObject({ endsAtMs: null, startsAtMs: null });
    expect(list[3]).toMatchObject({ startsAtMs: NOW + 5 * MIN, endsAtMs: null });
  });

  it('keeps an upcoming quiz without a usable start time, after the timed ones', () => {
    const list = toLandingQuizzes(snap([
      quiz('no-time', { status: 'upcoming' }),
      quiz('bad-time', { status: 'upcoming', startsAt: 'not a date' }),
      quiz('timed', { status: 'upcoming', startsAt: at(MIN) }),
    ]), NOW);
    expect(list.map((q) => [q.id, q.startsAtMs])).toEqual([['timed', NOW + MIN], ['no-time', null], ['bad-time', null]]);
  });

  it('shows at most a handful of cards', () => {
    const many = Array.from({ length: 8 }, (_, i) => quiz(`q${i}`));
    expect(toLandingQuizzes(snap(many), NOW)).toHaveLength(MAX_LANDING_QUIZZES);
  });

  it('names the prize: the linked prize, a bumper draw, or leaderboard points', () => {
    const [linked, bumper, plain] = toLandingQuizzes(snap([
      quiz('linked', { prizeName: 'Ronin Earbuds', isBumperPrize: true }),
      quiz('bumper', { isBumperPrize: true }),
      quiz('plain'),
    ]), NOW);
    expect(linked).toMatchObject({ prize: 'Ronin Earbuds', hasPrize: true, isBumperPrize: true });
    expect(bumper).toMatchObject({ prize: 'Bumper prize', hasPrize: true });
    expect(plain).toMatchObject({ prize: 'Leaderboard points', hasPrize: false, isBumperPrize: false });
  });

  it('prices entry only while the wallet is on', () => {
    const quizzes = [quiz('paid', { accessPrice: 2.5 }), quiz('free', { accessPrice: 0 }), quiz('big', { accessPrice: 1500 })];
    expect(toLandingQuizzes(snap(quizzes, true), NOW).map((q) => q.entry)).toEqual(['2.5 PKR', 'Free', '1,500 PKR']);
    expect(toLandingQuizzes(snap(quizzes, false), NOW).map((q) => q.entry)).toEqual(['Free', 'Free', 'Free']);
  });

  it('carries what the card footer shows', () => {
    expect(toLandingQuizzes(snap([quiz('a', { questionCount: 12, duration: 15, totalAttempts: 42 })]), NOW)[0])
      .toMatchObject({ title: 'Quiz a', questionCount: 12, duration: 15, totalAttempts: 42 });
  });
});

describe('nextQuizStart', () => {
  it('picks the soonest start still ahead', () => {
    const list = toLandingQuizzes(snap([
      quiz('live', { pushedAt: at(-MIN) }),
      quiz('late', { status: 'upcoming', startsAt: at(90 * MIN) }),
      quiz('overdue', { status: 'upcoming', startsAt: at(-MIN) }),
      quiz('next', { status: 'upcoming', startsAt: at(30 * MIN) }),
      quiz('no-time', { status: 'upcoming' }),
    ]), NOW);
    expect(nextQuizStart(list, NOW)).toBe(NOW + 30 * MIN);
    expect(nextQuizStart(list, NOW + 60 * MIN)).toBe(NOW + 90 * MIN);
    expect(nextQuizStart(list, NOW + 90 * MIN)).toBeNull();
    expect(nextQuizStart([], NOW)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('shows days, hours, minutes and, in the last hour or on request, seconds', () => {
    expect(formatCountdown(((2 * 24 + 4) * 60 + 5) * MIN + 9_000)).toBe('2d 04h 05m');
    expect(formatCountdown(((2 * 24 + 4) * 60 + 5) * MIN, true)).toBe('2d 04h 05m');
    expect(formatCountdown((2 * 60 + 14) * MIN + 5_000)).toBe('02h 14m');
    expect(formatCountdown((2 * 60 + 14) * MIN + 5_000, true)).toBe('02h 14m 05s');
    expect(formatCountdown(14 * MIN + 5_999)).toBe('14m 05s');
    expect(formatCountdown(0)).toBe('00m 00s');
    expect(formatCountdown(-5_000)).toBe('00m 00s');
  });
});
