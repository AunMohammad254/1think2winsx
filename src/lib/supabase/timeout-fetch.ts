/**
 * fetch() with a hard timeout, for server-side Supabase clients.
 *
 * Without it a slow or saturated PostgREST/Auth leaves every request waiting for undici's
 * default timeouts (minutes). Under a traffic spike that piles requests up in Node memory
 * until the platform proxy gives up (504) while Node keeps working on dead requests.
 *
 * Use as `createClient(url, key, { global: { fetch: createTimeoutFetch(ms) } })`.
 */

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Per-request budget for user-facing Supabase calls (reads, RPCs, auth). */
export const SUPABASE_FETCH_TIMEOUT_MS = envMs('SUPABASE_FETCH_TIMEOUT_MS', 10_000);
/**
 * Budget for the shared service-role client. Longer on purpose: the admin client also runs
 * heavy admin RPCs (quiz evaluation over every attempt). The database-side statement_timeout
 * is the real guard there.
 */
export const SUPABASE_ADMIN_FETCH_TIMEOUT_MS = envMs('SUPABASE_ADMIN_FETCH_TIMEOUT_MS', 30_000);

export function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
}
