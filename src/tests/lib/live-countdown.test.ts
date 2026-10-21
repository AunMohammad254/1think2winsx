import { describe, it, expect } from 'vitest';
import { describeStart, formatClock } from '@/lib/live-countdown';

describe('formatClock', () => {
  it('shows m:ss, or h:mm:ss past an hour, rounding up and never below zero', () => {
    expect(formatClock(42_000)).toBe('0:42');
    expect(formatClock(41_001)).toBe('0:42');
    expect(formatClock(12 * 60_000 + 4_000)).toBe('12:04');
    expect(formatClock(3_909_000)).toBe('1:05:09');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-5_000)).toBe('0:00');
  });
});

describe('describeStart', () => {
  // Local noon, so "later today" and "another day" don't depend on the test machine's timezone
  const noon = new Date(2026, 9, 19, 12, 0, 0).getTime();
  const HOUR = 3_600_000;

  it('counts down in the last hour', () => {
    expect(describeStart(noon + 12 * 60_000 + 4_000, noon)).toBe('in 12:04');
    expect(describeStart(noon + HOUR, noon)).toBe('in 1:00:00');
    // Already due (the scheduler is about to take it live)
    expect(describeStart(noon - 1_000, noon)).toBe('in 0:00');
  });

  it('gives the time later today, and the date beyond', () => {
    // Locale-dependent: "2:00 PM", "2:00 pm" or "14:00"
    expect(describeStart(noon + 2 * HOUR, noon)).toMatch(/^at (2:00\s?pm|14:00)$/i);
    expect(describeStart(noon + 50 * HOUR, noon)).toMatch(/^(Oct 21|21 Oct), (2:00\s?pm|14:00)$/i);
  });

  it('says "soon" without a start time', () => {
    expect(describeStart(null, noon)).toBe('soon');
  });
});
