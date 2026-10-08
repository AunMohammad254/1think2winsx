// Shared helpers for the k6 scenarios. k6 runs these as ES modules in its own runtime (not Node).
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';

export const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
if (!BASE_URL) {
  throw new Error('Set BASE_URL (the STAGING app, e.g. -e BASE_URL=https://staging.example.com)');
}

// sessions.json is produced by `prepare-users.ts sessions`: [{ userId, email, cookie }]
// SharedArray keeps ONE copy in memory for all virtual users (it can be hundreds of MB at 50k).
// Missing file => empty list, so anonymous-only scenarios (public.js) still run without any users.
export const sessions = new SharedArray('sessions', function () {
  try {
    return JSON.parse(open('../.data/sessions.json'));
  } catch (_e) {
    return [];
  }
});

export function sessionFor(index) {
  if (sessions.length === 0) {
    throw new Error('No sessions found. Run prepare-users.ts "seed" then "sessions" first (see README).');
  }
  return sessions[index % sessions.length];
}

// Requests the app deliberately refused because it was overloaded (HTTP 503 + Retry-After)
export const shed503 = new Counter('shed_503');
// Responses that are neither success nor a deliberate shed: real errors
export const hardErrors = new Counter('hard_errors');

export function jsonHeaders(cookie, extra = {}) {
  return Object.assign({ Cookie: cookie, Accept: 'application/json' }, extra);
}

// 43 URL-safe chars: passes the app's CSRF token format check (>= 32, [A-Za-z0-9_-])
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
export function randomCsrfToken() {
  let t = '';
  for (let i = 0; i < 43; i++) t += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return t;
}

/** Classify a response. `okStatuses` are the statuses that count as success for the scenario. */
export function record(res, okStatuses) {
  if (okStatuses.indexOf(res.status) !== -1) return true;
  if (res.status === 503 && res.headers['Retry-After']) {
    shed503.add(1);
    return false;
  }
  hardErrors.add(1);
  return false;
}

// NOTE: unlike open(), handleSummary file paths are relative to the directory k6 is RUN from,
// so run k6 from the repository root (as in the README) and make sure the folder exists.
export function summaryTo(name, data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    stdout: textSummary(data),
    [`load-test/.data/results-${name}-${stamp}.json`]: JSON.stringify(data, null, 2),
  };
}

function ms(v) {
  return v === undefined ? 'n/a' : `${Math.round(v)} ms`;
}

function textSummary(data) {
  const d = data.metrics.http_req_duration && data.metrics.http_req_duration.values;
  const reqs = data.metrics.http_reqs && data.metrics.http_reqs.values;
  const failed = data.metrics.http_req_failed && data.metrics.http_req_failed.values;
  const shed = data.metrics.shed_503 ? data.metrics.shed_503.values.count : 0;
  const hard = data.metrics.hard_errors ? data.metrics.hard_errors.values.count : 0;
  return [
    '',
    '  requests        ' + (reqs ? `${reqs.count} (${reqs.rate.toFixed(1)}/s)` : 'n/a'),
    '  latency p50/p95/p99  ' + (d ? `${ms(d.med)} / ${ms(d['p(95)'])} / ${ms(d['p(99)'])}` : 'n/a'),
    '  http failures   ' + (failed ? `${(failed.rate * 100).toFixed(2)}%` : 'n/a'),
    `  shed with 503   ${shed}   (deliberate load shedding, clients retry)`,
    `  hard errors     ${hard}   (anything else that was not a success)`,
    '',
  ].join('\n');
}
