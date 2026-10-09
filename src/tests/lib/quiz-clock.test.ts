// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computeQuizEndsAt, localWindowEnd, remainingSeconds, isWindowClosed } from '@/lib/quiz-clock';

const MIN = 60_000;

describe('computeQuizEndsAt', () => {
  it('is pushedAt + duration', () => {
    expect(computeQuizEndsAt('2026-10-09T10:00:00.000Z', 30)).toBe('2026-10-09T10:30:00.000Z');
    expect(computeQuizEndsAt(new Date('2026-10-09T10:00:00.000Z'), 5)).toBe('2026-10-09T10:05:00.000Z');
  });

  it('is null when the quiz was never pushed, or the inputs are unusable', () => {
    expect(computeQuizEndsAt(null, 30)).toBeNull();
    expect(computeQuizEndsAt(undefined, 30)).toBeNull();
    expect(computeQuizEndsAt('2026-10-09T10:00:00Z', 0)).toBeNull();
    expect(computeQuizEndsAt('2026-10-09T10:00:00Z', null)).toBeNull();
    expect(computeQuizEndsAt('not a date', 30)).toBeNull();
  });
});

describe('localWindowEnd', () => {
  const endsAt = '2026-10-09T10:30:00.000Z';
  const endMs = Date.parse(endsAt);

  it('equals the server deadline when the device clock is right', () => {
    const now = endMs - 10 * MIN;
    expect(localWindowEnd(endsAt, now, now)).toBe(endMs);
  });

  it('cancels out a device clock that is 2 hours fast (the deadline moves with it)', () => {
    const serverNow = endMs - 10 * MIN;
    const deviceNow = serverNow + 2 * 60 * MIN; // device thinks it is 2 h later
    const end = localWindowEnd(endsAt, serverNow, deviceNow)!;
    expect(end - deviceNow).toBe(10 * MIN); // still "10 minutes from now" on the device
  });

  it('cancels out a device clock that is 3 minutes slow', () => {
    const serverNow = endMs - 10 * MIN;
    const deviceNow = serverNow - 3 * MIN;
    expect(localWindowEnd(endsAt, serverNow, deviceNow)! - deviceNow).toBe(10 * MIN);
  });

  it('is null without a deadline; assumes no skew without a server clock', () => {
    expect(localWindowEnd(null, 1, 1)).toBeNull();
    expect(localWindowEnd('garbage', 1, 1)).toBeNull();
    expect(localWindowEnd(endsAt, null, 123)).toBe(endMs);
  });
});

describe('remainingSeconds', () => {
  it('is the full duration for a quiz without a fixed window', () => {
    expect(remainingSeconds({ nowMs: 0, durationMinutes: 30, startedAtMs: null, windowEndLocalMs: null })).toBe(30 * 60);
  });

  it('counts down from when the player pressed Start', () => {
    const r = remainingSeconds({ nowMs: 5 * MIN, durationMinutes: 30, startedAtMs: 0, windowEndLocalMs: null });
    expect(r).toBe(25 * 60);
  });

  it('a late joiner sees the time left in the window, not a full timer', () => {
    // Quiz went live 20 minutes ago with a 30 minute duration; the player opens it now
    const nowMs = 20 * MIN;
    const windowEnd = 30 * MIN;
    expect(remainingSeconds({ nowMs, durationMinutes: 30, startedAtMs: null, windowEndLocalMs: windowEnd })).toBe(10 * 60);
    // ... and pressing Start does not restore the lost time
    expect(remainingSeconds({ nowMs, durationMinutes: 30, startedAtMs: nowMs, windowEndLocalMs: windowEnd })).toBe(10 * 60);
  });

  it('an early joiner still gets at most their own duration', () => {
    // Window has 25 minutes left but the quiz is only 10 minutes long
    expect(remainingSeconds({ nowMs: 0, durationMinutes: 10, startedAtMs: 0, windowEndLocalMs: 25 * MIN })).toBe(10 * 60);
  });

  it('never goes negative once the window is over', () => {
    expect(remainingSeconds({ nowMs: 31 * MIN, durationMinutes: 30, startedAtMs: 0, windowEndLocalMs: 30 * MIN })).toBe(0);
  });

  it('rounds partial seconds up so the display reaches 0:00 exactly at the deadline', () => {
    expect(remainingSeconds({ nowMs: 0, durationMinutes: 1, startedAtMs: null, windowEndLocalMs: 1_200 })).toBe(2);
    expect(remainingSeconds({ nowMs: 0, durationMinutes: 1, startedAtMs: null, windowEndLocalMs: 1_000 })).toBe(1);
  });
});

describe('isWindowClosed', () => {
  it('is true only at or after the end of a fixed window', () => {
    expect(isWindowClosed(null, 999)).toBe(false);
    expect(isWindowClosed(1_000, 999)).toBe(false);
    expect(isWindowClosed(1_000, 1_000)).toBe(true);
    expect(isWindowClosed(1_000, 5_000)).toBe(true);
  });
});
