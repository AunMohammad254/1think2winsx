/**
 * fetch() with retry + exponential backoff + full jitter, for the browser.
 *
 * During a live quiz thousands of clients hit the same endpoints at once. When the server
 * answers 429/502/503/504 (or the network drops), retrying immediately — or all at the same
 * moment — turns a short overload into a sustained one. This waits `Retry-After` when the
 * server provides it, otherwise backs off exponentially, and always adds random jitter.
 *
 * Only use it for requests that are safe to repeat (GETs and idempotent writes such as
 * quiz submission, which the database de-duplicates).
 */

export interface RetryOptions {
  /** Retries after the first attempt. Default 3. */
  retries?: number;
  /** First backoff step in ms. Default 800. */
  baseDelayMs?: number;
  /** Upper bound for a single wait in ms. Default 15000. */
  maxDelayMs?: number;
  /** Status codes worth retrying. */
  retryOn?: readonly number[];
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const DEFAULT_RETRY_ON = [429, 502, 503, 504] as const;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  const {
    retries = 3,
    baseDelayMs = 800,
    maxDelayMs = 15_000,
    retryOn = DEFAULT_RETRY_ON,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  let attempt = 0;
  for (;;) {
    let response: Response | null = null;
    let networkError: unknown = null;
    try {
      response = await fetch(input, init);
    } catch (err) {
      networkError = err;
      // A caller-initiated abort is not a transient failure.
      if (init?.signal?.aborted) throw err;
    }

    const retryable = networkError !== null || (response !== null && retryOn.includes(response.status));
    if (!retryable || attempt >= retries) {
      if (response) return response;
      throw networkError;
    }

    const serverHint = response ? retryAfterMs(response) : null;
    const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    // Full jitter on the exponential step; honour the server's Retry-After as a floor.
    const wait = Math.min(maxDelayMs, Math.max(serverHint ?? 0, random() * backoff));
    attempt++;
    await sleep(wait);
  }
}
