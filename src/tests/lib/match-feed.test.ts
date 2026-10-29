// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LoadedMatch } from '@/lib/match-service';

const loadMatch = vi.fn();
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: vi.fn(), generateId: vi.fn(), notificationDb: {} }));
vi.mock('@/lib/admin-action-log', () => ({ logQuizAction: vi.fn() }));
// The real view (scores, labels, question states); only the database read is a stand-in
vi.mock('@/lib/match-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/match-service')>()),
  loadMatch: (...a: unknown[]) => loadMatch(...a),
}));

const { buildPublicMatch, getPublicMatch } = await import('@/lib/match-feed');

const NOW = Date.parse('2026-10-29T12:00:00Z');
const ball = (seq: number, over: Record<string, unknown> = {}) =>
  ({ id: `b${seq}`, innings: 1 as const, seq, runs: 1, extra: 'none' as const, extraRuns: 0, wicket: false, ...over });
const questionRow = (over: Record<string, unknown> = {}) => ({
  id: 'q1', text: 'Lahore: will over 2 go for 8 or more runs?', textRomanUrdu: 'Lahore: kya over 2 mein 8 ya us se zyada runs banenge?',
  options: '["Yes","No"]', matchInnings: 1 as const, matchOver: 2, market: 'over_runs_at_least', marketParams: { line: 8 },
  status: 'active' as const, hasCorrectAnswer: false, correctOption: null, closesAt: '2026-10-29T12:01:00Z', ...over,
});

function loaded(over: Partial<LoadedMatch> = {}): LoadedMatch {
  const questions = [
    questionRow(),
    questionRow({ id: 'q0', matchOver: 1, hasCorrectAnswer: true, correctOption: 1, closesAt: '2026-10-29T11:50:00Z' }),
    questionRow({ id: 'qv', matchOver: 1, status: 'paused', correctOption: 0 }),
  ];
  const balls = [ball(1, { runs: 4 }), ball(2, { wicket: true, runs: 0 }), ball(3, { extra: 'wide', extraRuns: 1, runs: 0 })];
  return {
    row: {
      id: 'm1', quizId: 'quiz1', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 2, questionsPerOver: 2,
      firstWindowSeconds: 120, lockFallbackSeconds: 150, status: 'live', autoSend: false, version: 7, createdAt: '2026-10-29T10:00:00Z',
    },
    title: 'Lahore vs Karachi',
    published: true,
    players: { entries: 5, maxEntries: 2000 },
    settled: false,
    questions,
    drafts: [{
      id: 'd1', innings: 1, over: 3, market: 'wicket_in_over', params: {}, options: ['Yes', 'No'], text: 'SECRET DRAFT', textRomanUrdu: 'x',
      plainText: 'x', plainTextRomanUrdu: 'x', ai: false, closesAt: '2026-10-29T12:05:00Z',
    }],
    state: {
      config: { teams: ['Lahore', 'Karachi'], oversPerInnings: 2, questionsPerOver: 2, firstWindowSeconds: 120, lockFallbackSeconds: 150 },
      status: 'live',
      innings: [{ innings: 1, battingTeam: 'Lahore', endReason: null }],
      balls,
      questions: questions.map((q) => ({
        id: q.id, innings: 1, over: q.matchOver, market: q.market, params: q.marketParams, status: q.status,
        hasResult: q.hasCorrectAnswer, correctOption: q.correctOption, closed: Date.parse(q.closesAt) <= NOW,
      })),
      draftSlots: [{ innings: 1, over: 3 }],
    },
    ...over,
  };
}

beforeEach(() => loadMatch.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('buildPublicMatch', () => {
  it('gives players the score ball by ball and the questions sent, never drafts or the scorer\'s settings', async () => {
    loadMatch.mockResolvedValue(loaded());
    const match = (await buildPublicMatch('m1', NOW))!;
    // With the player counts, for entriesClosed
    expect(loadMatch).toHaveBeenCalledWith('m1', NOW, true);
    expect(match.match).toEqual({
      id: 'm1', quizId: 'quiz1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 2, status: 'live',
      settled: false, entriesClosed: false,
    });
    expect(match.innings).toEqual([{
      innings: 1, battingTeam: 'Lahore', endReason: null, runs: 5, wickets: 1, oversText: '0.2', target: null,
      overs: [{ number: 1, runs: 5, wickets: 1, complete: false, balls: ['4', 'W', 'Wd'] }],
    }]);
    expect(match.questions).toEqual([
      {
        id: 'q1', innings: 1, over: 2, text: 'Lahore: will over 2 go for 8 or more runs?', textRomanUrdu: 'Lahore: kya over 2 mein 8 ya us se zyada runs banenge?',
        options: ['Yes', 'No'], state: 'open', closesAt: '2026-10-29T12:01:00Z', correctOption: null,
      },
      expect.objectContaining({ id: 'q0', state: 'settled', correctOption: 1 }),
      // A voided question's option never shows
      expect.objectContaining({ id: 'qv', state: 'void', correctOption: null }),
    ]);
    expect(match.serverNow).toBe(new Date(NOW).toISOString());
    const json = JSON.stringify(match);
    for (const hidden of ['SECRET DRAFT', 'autoSend', 'version', 'market', 'reopenable', 'firstWindowSeconds', 'maxEntries']) expect(json).not.toContain(hidden);
  });

  it('says when the match is full and settled', async () => {
    loadMatch.mockResolvedValue(loaded({ players: { entries: 2000, maxEntries: 2000 }, settled: true }));
    expect((await buildPublicMatch('m1'))!.match).toMatchObject({ entriesClosed: true, settled: true });
  });

  it('shows nothing of a match players can\'t see, or that doesn\'t exist', async () => {
    loadMatch.mockResolvedValue(loaded({ published: false }));
    expect(await buildPublicMatch('m1')).toBeNull();
    loadMatch.mockResolvedValue(null);
    expect(await buildPublicMatch('nope')).toBeNull();
  });
});

describe('getPublicMatch', () => {
  it('loads a match once however many ask at the same moment, and keeps it 1.5 s', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    let release!: (value: LoadedMatch) => void;
    loadMatch.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const together = [getPublicMatch('a'), getPublicMatch('a')];
    release(loaded());
    const [first, second] = await Promise.all(together);
    expect(first).toBe(second);
    expect(loadMatch).toHaveBeenCalledTimes(1);

    clock.mockReturnValue(NOW + 1_499);
    expect(await getPublicMatch('a')).toBe(first);
    expect(loadMatch).toHaveBeenCalledTimes(1);
    loadMatch.mockResolvedValue(loaded({ published: false }));
    clock.mockReturnValue(NOW + 1_500);
    // A hidden match is kept as hidden too
    expect(await getPublicMatch('a')).toBeNull();
    expect(await getPublicMatch('a')).toBeNull();
    expect(loadMatch).toHaveBeenCalledTimes(2);
  });

  it('keeps each match apart, drops old copies, and never keeps a failed load', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW + 10_000);
    loadMatch.mockResolvedValue(loaded());
    await getPublicMatch('b');
    await getPublicMatch('c');
    expect(loadMatch).toHaveBeenCalledTimes(2);

    clock.mockReturnValue(NOW + 20_000);
    loadMatch.mockRejectedValueOnce(new Error('down'));
    await expect(getPublicMatch('b')).rejects.toThrow('down');
    expect(await getPublicMatch('b')).not.toBeNull();
    expect(loadMatch).toHaveBeenCalledTimes(4);
  });
});
