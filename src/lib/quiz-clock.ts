/**
 * Quiz answering window, measured on the SERVER's clock.
 *
 * The database accepts answers until `pushedAt + duration` (plus a 30 s grace period, see
 * `submit_quiz_attempt`). The quiz screens used to show a full `duration` countdown from the moment
 * the player pressed Start, so a player who opened the quiz 20 minutes into a 30-minute window saw
 * "30:00", worked for half an hour and then had the submission rejected as closed. These helpers let
 * the client count down to the real deadline instead, regardless of how wrong the device clock is.
 *
 * Pure functions only (no `Date.now()` inside), so they are trivial to test.
 */

/** ISO time at which the answering window closes, or null when the quiz was never pushed live. */
export function computeQuizEndsAt(
  pushedAt: string | Date | null | undefined,
  durationMinutes: number | null | undefined,
): string | null {
  if (!pushedAt || !durationMinutes || durationMinutes <= 0) return null;
  const start = new Date(pushedAt).getTime();
  if (!Number.isFinite(start)) return null;
  return new Date(start + durationMinutes * 60_000).toISOString();
}

/**
 * Where the end of the window falls on THIS device's clock.
 *
 * `serverNowMs` is the server's clock when it answered and `receivedAtMs` is the device clock when the
 * answer arrived, so `serverNowMs - receivedAtMs` is how far the device is off. Network latency is
 * ignored: it makes the countdown a fraction of a second generous, well inside the server's 30 s grace.
 */
export function localWindowEnd(
  endsAt: string | null | undefined,
  serverNowMs: number | null | undefined,
  receivedAtMs: number,
): number | null {
  if (!endsAt) return null;
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return null;
  const skew = typeof serverNowMs === 'number' && Number.isFinite(serverNowMs) ? serverNowMs - receivedAtMs : 0;
  return end - skew;
}

/**
 * Seconds the player has left: the sooner of
 *  - their own `duration` from the moment they pressed Start (or from now, before Start), and
 *  - the end of the quiz's answering window.
 */
export function remainingSeconds(args: {
  nowMs: number;
  durationMinutes: number;
  /** Device time at which the player pressed Start; null before they did. */
  startedAtMs: number | null;
  /** Result of `localWindowEnd`; null when the quiz has no fixed window. */
  windowEndLocalMs: number | null;
}): number {
  const personalDeadline = (args.startedAtMs ?? args.nowMs) + args.durationMinutes * 60_000;
  const deadline =
    args.windowEndLocalMs === null ? personalDeadline : Math.min(personalDeadline, args.windowEndLocalMs);
  return Math.max(0, Math.ceil((deadline - args.nowMs) / 1000));
}

/** True once the quiz's answering window is over (so starting it is pointless). */
export function isWindowClosed(windowEndLocalMs: number | null, nowMs: number): boolean {
  return windowEndLocalMs !== null && windowEndLocalMs <= nowMs;
}
