'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * Lock-ins and the edge Worker (edge-shield/). The Worker takes a quiz's lock-in at Cloudflare, answers
 * 202 "received" (`results.status: 'received'`) and saves it in Supabase 0-2 minutes later, so a crowd's
 * lock-ins never reach Hostinger. Its kill switch sends them to Hostinger as before, which answers 200.
 * Both mean the answers are in.
 *
 * A live match's over goes through the queue too: every player locks one in each over, which is the burst
 * Hostinger's per-second block can't take. The batch save judges each lock-in by the time the edge received
 * it, against each question's own close time (submit_lockin_batch), so the queue never makes a player late.
 * (Builds before this one sent match overs to Hostinger with X-Lockin-Direct: 1; the Worker still honours it.)
 */
export const LOCK_IN_RECEIVED = 202;

/**
 * What a player is told once a lock-in is taken. The same words for 200 and 202: both count, and a second
 * wording ("received") reads as "not counted yet" to someone who has just paid to play.
 */
export function lockedInMessage(answers: number): string {
  return `Locked in. Your answer${answers === 1 ? ' counts' : 's count'}.`;
}

/** The Worker's answer when the access token in the session cookie has lapsed. */
async function sessionExpired(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const data = await res.clone().json().catch(() => null);
  return data?.code === 'session_expired';
}

/**
 * Sends a lock-in with `send`. The Worker only reads the session cookie, and refreshes nothing: when it
 * answers 401 `session_expired`, the browser client refreshes the session (its new cookie goes with the
 * next request) and the lock-in is sent once more. Any other answer, or a refresh that fails, is returned
 * as it came.
 */
export async function sendLockIn(send: () => Promise<Response>): Promise<Response> {
  const res = await send();
  if (!(await sessionExpired(res))) return res;
  const { error } = await createClient().auth.refreshSession();
  return error ? res : send();
}
