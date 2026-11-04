'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * Lock-ins and the edge Worker (edge-shield/). The Worker takes a quiz's lock-in at Cloudflare, answers
 * 202 "received" (`results.status: 'received'`) and saves it in Supabase 0-2 minutes later, so a crowd's
 * lock-ins never reach Hostinger. Its kill switch sends them to Hostinger as before, which answers 200.
 * Both mean the answers are in.
 */
export const LOCK_IN_RECEIVED = 202;

/**
 * Sent with a live match's over: it goes to Hostinger as before, never the queue, because each over's
 * questions close at their own time and the match screen needs the server's answer.
 */
export const LOCK_IN_DIRECT_HEADER = 'X-Lockin-Direct';

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
