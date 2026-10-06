/**
 * Schedule-time handling for quizzes.
 *
 * WHY THIS EXISTS: the admin date picker produces a zone-less wall-clock string
 * ("2026-12-01T16:30"). JavaScript reads a zone-less string in the *machine's*
 * timezone, so the same string meant different instants on the admin's laptop
 * (PKT, UTC+5) and on the server (UTC). A 4:30 pm quiz was stored as 16:30 UTC and
 * shown as 9:30 pm. Nothing that stores or compares a schedule time may rely on
 * `new Date("<zone-less string>")`; go through `toUtcIso` instead.
 *
 * Contract:
 *  - The browser converts the picker value to an absolute instant (ISO with `Z`) using
 *    the ADMIN'S timezone before sending it (see QuizFormBuilder).
 *  - The server accepts any string with an explicit offset as-is, and treats a
 *    zone-less string as wall time in the platform's business timezone rather than
 *    server-local time, so the result is identical on every machine, whatever its TZ.
 *
 * The business timezone defaults to Asia/Karachi and can be changed with the
 * NEXT_PUBLIC_APP_TIME_ZONE env var (any IANA name, e.g. "Asia/Dubai"). It is used for
 * zone-less input and for the time written inside notification text.
 */

const DEFAULT_TIME_ZONE = 'Asia/Karachi';

/** The platform's business timezone (read on every call so it follows the env). */
export function getBusinessTimeZone(): string {
  const configured = process.env.NEXT_PUBLIC_APP_TIME_ZONE?.trim();
  if (!configured) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured });
    return configured;
  } catch {
    return DEFAULT_TIME_ZONE; // unknown name: don't crash scheduling over a typo
  }
}

/** Offset (ms) of `timeZone` from UTC at the given instant: local wall time minus UTC. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

/** UTC instant (ms) for a wall-clock time in `timeZone`. Handles daylight saving zones. */
function wallTimeToUtcMs(wallAsUtcMs: number, timeZone: string): number {
  const first = wallAsUtcMs - zoneOffsetMs(wallAsUtcMs, timeZone);
  // Second pass: the offset at the first guess can differ across a DST boundary
  return wallAsUtcMs - zoneOffsetMs(first, timeZone);
}

// "2026-12-01T16:30", "2026-12-01 16:30:15", "2026-12-01T16:30:15.250" - no zone designator
const ZONELESS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;

/**
 * Normalises a schedule time to a UTC ISO string, independent of the host timezone.
 * Returns null for empty or unparseable input.
 */
export function toUtcIso(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;

  const m = ZONELESS.exec(value);
  if (!m) {
    const date = new Date(value); // has an explicit zone ("Z" / "+05:00"): unambiguous
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] ? Number(m[6]) : 0;
  const millis = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;

  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  if (new Date(wallAsUtc).getUTCDate() !== day) return null; // e.g. 31 Feb

  return new Date(wallTimeToUtcMs(wallAsUtc, getBusinessTimeZone())).toISOString();
}

// Browsers/Node only know abbreviations for a few zones ("GMT+5" for Karachi), so the
// common ones for this platform are spelled out.
const ZONE_LABELS: Record<string, string> = {
  'Asia/Karachi': 'PKT',
  'Asia/Dubai': 'GST',
  'Asia/Kolkata': 'IST',
  'Asia/Riyadh': 'AST',
};

/** Formats an instant for notification text, e.g. "Dec 1, 2026, 4:30 PM PKT". */
export function formatBusinessTime(instant: string | Date): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const timeZone = getBusinessTimeZone();
  const text = date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  });
  const label = ZONE_LABELS[timeZone]
    ?? new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value;
  return label ? `${text} ${label}` : text;
}
