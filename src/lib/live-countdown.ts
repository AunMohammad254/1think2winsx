/**
 * Countdown text for the live stream's quiz pop-ups. Pure functions with the clock passed in.
 */

/** "0:42", "12:04" or "1:05:09" for a duration in milliseconds (rounded up, never negative). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * When an upcoming quiz starts: a live countdown in its last hour ("in 12:04"), the time later the
 * same day ("at 8:30 PM"), and the date beyond that ("Oct 21, 8:30 PM"). Null start time: "soon".
 */
export function describeStart(startsAtMs: number | null, nowMs: number): string {
  if (startsAtMs === null) return 'soon';
  const left = startsAtMs - nowMs;
  if (left <= 60 * 60_000) return `in ${formatClock(left)}`;
  const start = new Date(startsAtMs);
  const time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (start.toDateString() === new Date(nowMs).toDateString()) return `at ${time}`;
  return `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}
