import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

/**
 * Load shedding for the hot read routes (quiz list, quiz by id).
 *
 * When the single Node process is saturated, accepting more work only makes everyone slower:
 * requests queue, memory grows, and the platform proxy eventually returns 504 for requests that
 * Node is still working on. Answering a fast `503 + Retry-After` instead keeps the requests we
 * do accept quick, and the jittered Retry-After spreads the retries out.
 *
 * Shedding triggers on EITHER signal:
 *   - in-flight requests on guarded routes >= LOAD_SHED_MAX_INFLIGHT   (default 1500)
 *   - event-loop delay p99 over the last window >= LOAD_SHED_MAX_LAG_MS (default 2000)
 * Set a variable to 0 to disable that signal. The defaults are deliberately loose — a safety
 * valve, not a tuned limit; calibrate them from the load test (scripts/loadtest).
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const LAG_WINDOW_MS = 5_000;

let inflight = 0;
let histogram: IntervalHistogram | null = null;
let lagTimer: ReturnType<typeof setInterval> | null = null;
let lagP99Ms = 0;
let shedTotal = 0;

function ensureLagSampler(): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  lagTimer = setInterval(() => {
    if (!histogram) return;
    lagP99Ms = histogram.percentile(99) / 1e6; // ns -> ms
    histogram.reset();
  }, LAG_WINDOW_MS);
  lagTimer.unref(); // never keep the process alive just for metrics
}

export interface LoadStats {
  inflight: number;
  eventLoopLagP99Ms: number;
  shedTotal: number;
  rssMb: number;
  heapUsedMb: number;
}

export function getLoadStats(): LoadStats {
  ensureLagSampler();
  const mem = process.memoryUsage();
  return {
    inflight,
    eventLoopLagP99Ms: Math.round(lagP99Ms),
    shedTotal,
    rssMb: Math.round(mem.rss / 1048576),
    heapUsedMb: Math.round(mem.heapUsed / 1048576),
  };
}

export function isOverloaded(): boolean {
  ensureLagSampler();
  const maxInflight = envInt('LOAD_SHED_MAX_INFLIGHT', 1500);
  const maxLag = envInt('LOAD_SHED_MAX_LAG_MS', 2000);
  if (maxInflight > 0 && inflight >= maxInflight) return true;
  if (maxLag > 0 && lagP99Ms >= maxLag) return true;
  return false;
}

function shedResponse(): Response {
  shedTotal++;
  // 1-6 s of jitter so shed clients don't all come back in the same instant
  const retryAfter = 1 + Math.floor(Math.random() * 6);
  return new Response(
    JSON.stringify({ error: 'Server is busy, please retry shortly', code: 'OVERLOADED', retryAfter }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
        'Cache-Control': 'no-store',
      },
    }
  );
}

/** Wrap a route handler so it is shed (503) while the process is overloaded. */
export function withLoadShed<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    if (isOverloaded()) return shedResponse();
    inflight++;
    try {
      return await handler(...args);
    } finally {
      inflight--;
    }
  };
}

/** Test hook. */
export function __resetLoadShedForTests(): void {
  inflight = 0;
  shedTotal = 0;
  lagP99Ms = 0;
  if (lagTimer) clearInterval(lagTimer);
  histogram?.disable();
  histogram = null;
  lagTimer = null;
}

/** Test hook: pretend the event loop is lagging. */
export function __setLagForTests(ms: number): void {
  ensureLagSampler();
  lagP99Ms = ms;
}
