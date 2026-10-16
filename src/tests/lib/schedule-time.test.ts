import { describe, it, expect, afterEach } from 'vitest';
import { toUtcIso, formatBusinessTime } from '@/lib/schedule-time';
import { QuizFormSchema } from '@/lib/schemas/QuizFormSchema';

const originalTz = process.env.TZ;
const originalAppTz = process.env.NEXT_PUBLIC_APP_TIME_ZONE;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
  if (originalAppTz === undefined) delete process.env.NEXT_PUBLIC_APP_TIME_ZONE;
  else process.env.NEXT_PUBLIC_APP_TIME_ZONE = originalAppTz;
});

describe('toUtcIso', () => {
  // The regression: a 4:30 pm pick must not depend on the server's timezone.
  it.each(['UTC', 'Asia/Karachi', 'America/New_York', 'Pacific/Auckland'])(
    'reads a zone-less 4:30 pm as 4:30 pm Pakistan time when the host TZ is %s',
    (tz) => {
      process.env.TZ = tz;
      expect(toUtcIso('2026-12-01T16:30')).toBe('2026-12-01T11:30:00.000Z');
      expect(toUtcIso('2026-12-01 16:30:00')).toBe('2026-12-01T11:30:00.000Z');
    }
  );

  it('keeps an explicit UTC instant untouched (what the browser sends)', () => {
    for (const tz of ['UTC', 'Asia/Karachi']) {
      process.env.TZ = tz;
      expect(toUtcIso('2026-12-01T11:30:00.000Z')).toBe('2026-12-01T11:30:00.000Z');
    }
  });

  it('honours an explicit offset', () => {
    expect(toUtcIso('2026-12-01T16:30:00+05:00')).toBe('2026-12-01T11:30:00.000Z');
    expect(toUtcIso('2026-12-01T16:30:00+00:00')).toBe('2026-12-01T16:30:00.000Z');
  });

  it('round-trips what the database returns', () => {
    expect(toUtcIso('2026-10-06T11:42:00+00:00')).toBe('2026-10-06T11:42:00.000Z');
  });

  it('returns null for empty or invalid input', () => {
    expect(toUtcIso(null)).toBeNull();
    expect(toUtcIso('')).toBeNull();
    expect(toUtcIso('   ')).toBeNull();
    expect(toUtcIso('not-a-date')).toBeNull();
    expect(toUtcIso('2026-13-45T99:99')).toBeNull();
  });

  it('the browser conversion + server normalisation agree for a Pakistan admin', () => {
    process.env.TZ = 'Asia/Karachi'; // the admin's browser
    const sentByBrowser = new Date('2026-12-01T16:30').toISOString();
    process.env.TZ = 'UTC'; // the server
    expect(toUtcIso(sentByBrowser)).toBe('2026-12-01T11:30:00.000Z');
    // ...and an old cached page that still sends the raw picker value lands on the same instant
    expect(toUtcIso('2026-12-01T16:30')).toBe('2026-12-01T11:30:00.000Z');
  });
});

describe('configurable business timezone', () => {
  it('uses NEXT_PUBLIC_APP_TIME_ZONE for zone-less input (UTC+4 here)', () => {
    process.env.NEXT_PUBLIC_APP_TIME_ZONE = 'Asia/Dubai';
    expect(toUtcIso('2026-12-01T16:30')).toBe('2026-12-01T12:30:00.000Z');
  });

  it('handles daylight saving zones on both sides of the change', () => {
    process.env.NEXT_PUBLIC_APP_TIME_ZONE = 'America/New_York';
    expect(toUtcIso('2026-01-15T16:30')).toBe('2026-01-15T21:30:00.000Z'); // EST, UTC-5
    expect(toUtcIso('2026-07-15T16:30')).toBe('2026-07-15T20:30:00.000Z'); // EDT, UTC-4
  });

  it('falls back to Asia/Karachi for an unknown zone name', () => {
    process.env.NEXT_PUBLIC_APP_TIME_ZONE = 'Not/AZone';
    expect(toUtcIso('2026-12-01T16:30')).toBe('2026-12-01T11:30:00.000Z');
  });

  it('rejects impossible calendar dates instead of rolling them over', () => {
    expect(toUtcIso('2026-02-31T10:00')).toBeNull();
    expect(toUtcIso('2026-12-01T25:00')).toBeNull();
  });

  it('writes the time in notification text in the business timezone with its abbreviation', () => {
    expect(formatBusinessTime("2026-12-01T11:30:00.000Z")).toBe("Dec 1, 2026, 4:30 PM PKT");
  });
});

describe('QuizFormSchema startsAt uses the same parser', () => {
  const base = {
    title: 'Friday sports quiz', duration: 10, passingScore: 50, quizType: 'normal' as const,
    questions: [{
      text: 'Who won the 1992 Cricket World Cup?',
      options: [{ text: 'Pakistan', isCorrect: true }, { text: 'England', isCorrect: false }],
      correctOption: 0, status: 'active' as const,
    }],
  };
  it('accepts the picker value and an ISO instant', () => {
    expect(QuizFormSchema.safeParse({ ...base, status: 'scheduled', startsAt: '2026-12-01T16:30' }).success).toBe(true);
    expect(QuizFormSchema.safeParse({ ...base, status: 'scheduled', startsAt: '2026-12-01T11:30:00.000Z' }).success).toBe(true);
  });
});
