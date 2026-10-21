// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  formatResult, parseSmokeArgs, runSmoke, summarize, LIVE_CACHE_CONTROL, QUIZ_COPY_CACHE_CONTROL,
  type CheckResult, type Fetcher, type SmokeOptions,
} from './smoke-checks';

const BASE = 'https://1think2win.com';
const QUIZ = 'quiz123';
const options: SmokeOptions = { baseUrl: BASE, wwwUrl: 'https://www.1think2win.com/', pauseMs: 0, timeoutMs: 1_000 };

type Route = { status?: number; headers?: Record<string, string>; body?: string } | Error;

const liveBody = (quizzes: unknown[] = [{ id: 'up1', status: 'upcoming' }, { id: QUIZ, status: 'active' }]) =>
  JSON.stringify({ version: 'v1', quizzes });
const copyBody = (question: Record<string, unknown> = { id: 'q1', text: 'Which answer is correct?', options: ['a', 'b'] }) =>
  JSON.stringify({ quiz: { id: QUIZ, questions: [question], previousAttempt: null } });
const live = (cf: string) => ({ headers: { 'cache-control': LIVE_CACHE_CONTROL, 'cf-cache-status': cf }, body: liveBody() });
const copy = (cf: string) => ({ headers: { 'cache-control': QUIZ_COPY_CACHE_CONTROL, 'cf-cache-status': cf }, body: copyBody() });

// What production answered on 2026-10-18 (wallet off, one active quiz)
const PRODUCTION: Record<string, Route | Route[]> = {
  [`${BASE}/`]: { headers: { 'content-type': 'text/html' }, body: '<html><head><title>1Think 2Win</title></head></html>' },
  [`${BASE}/api/live`]: [live('EXPIRED'), live('HIT')],
  [`${BASE}/api/live?smoke=1`]: { status: 403, body: '<title>Attention Required! | Cloudflare</title> Sorry, you have been blocked' },
  [`${BASE}/api/settings/wallet-enabled`]: { body: '{"walletEnabled":false}' },
  [`${BASE}/api/live/quizzes/smoke-check-missing`]: { status: 404, headers: { 'cache-control': 'no-store' }, body: '{"error":"Quiz not found or inactive"}' },
  [`${BASE}/api/live/quizzes/${QUIZ}`]: [copy('MISS'), copy('HIT')],
  [`${BASE}/api/health`]: { headers: { 'cache-control': 'no-store' }, body: '{"status":"ok"}' },
  'https://www.1think2win.com/': { status: 301, headers: { location: `${BASE}/` } },
};

/** A fake site: answers from the route table (a list answers in turn) and records every request. */
function fakeSite(overrides: Record<string, Route | Route[]> = {}) {
  const routes = { ...PRODUCTION, ...overrides };
  const calls: { url: string; init: RequestInit }[] = [];
  const served = new Map<string, number>();
  let inFlight = 0;
  let maxInFlight = 0;
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await Promise.resolve();
    inFlight--;
    const entry = routes[url];
    if (!entry) throw new Error(`unexpected request ${url}`);
    const n = served.get(url) ?? 0;
    served.set(url, n + 1);
    const route = Array.isArray(entry) ? entry[Math.min(n, entry.length - 1)] : entry;
    if (route instanceof Error) throw route;
    // No body means no Content-Type, which a string body (even '') would get automatically
    return new Response(route.body ?? null, { status: route.status ?? 200, headers: route.headers });
  };
  return { fetcher, calls, maxInFlight: () => maxInFlight };
}

async function run(overrides: Record<string, Route | Route[]> = {}, opts: Partial<SmokeOptions> = {}) {
  const site = fakeSite(overrides);
  const results = await runSmoke({ ...options, ...opts }, site.fetcher);
  return { ...site, results };
}

const byName = (results: CheckResult[], name: string) => {
  const result = results.find((r) => r.name === name);
  if (!result) throw new Error(`no check named ${name}`);
  return result;
};
const failures = (results: CheckResult[]) => results.filter((r) => r.outcome === 'fail').map((r) => r.name);

describe('runSmoke', () => {
  it('passes against a healthy production, one small request at a time', async () => {
    const { results, calls, maxInFlight } = await run();
    expect(failures(results)).toEqual([]);
    expect(results.map((r) => `${r.outcome} ${r.status} ${r.name}`)).toEqual([
      'pass 200 GET /',
      'pass 200 GET /api/live',
      'pass 200 GET /api/live (again)',
      'pass 403 GET /api/live?smoke=1',
      'pass 200 GET /api/settings/wallet-enabled',
      'pass 404 GET /api/live/quizzes/smoke-check-missing',
      'pass 200 GET /api/live/quizzes/<active quiz>',
      'pass 200 GET /api/live/quizzes/<active quiz> (again)',
      'pass 200 GET /api/health',
      'pass 301 GET https://www.1think2win.com/',
    ]);
    expect(calls.length).toBeLessThanOrEqual(15);
    expect(maxInFlight()).toBe(1);
    // No sign-in, no secrets, no writes, never the authorised health views
    for (const { url, init } of calls) {
      expect(init.method ?? 'GET').toBe('GET');
      expect(JSON.stringify(init.headers).toLowerCase()).not.toMatch(/authorization|cookie/);
      expect(url).not.toMatch(/stats=|deep=/);
      expect(init.redirect).toBe('manual');
    }
    expect(byName(results, 'GET /api/live/quizzes/<active quiz>').detail).toBe(`id=${QUIZ}, cf-cache-status=MISS`);
  });

  it('pauses between requests when asked to', async () => {
    const started = Date.now();
    await run({}, { pauseMs: 5 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(9 * 5 - 5);
  });

  it('catches a parked-domain page served with 200', async () => {
    const { results } = await run({ [`${BASE}/`]: { body: '<title>Parked Domain name on Hostinger DNS system</title>' } });
    expect(byName(results, 'GET /').problems).toEqual([
      'title is "Parked Domain name on Hostinger DNS system", expected "1Think 2Win"',
      'page mentions "parked": a parked-domain page, not the app',
    ]);
  });

  it('fails a home page without a title, or one that redirects', async () => {
    expect(byName((await run({ [`${BASE}/`]: { body: '<p>hi</p>' } })).results, 'GET /').problems).toEqual(['title is (missing), expected "1Think 2Win"']);
    const redirected = byName((await run({ [`${BASE}/`]: { status: 302, headers: { location: 'https://elsewhere.example/' } } })).results, 'GET /');
    expect(redirected.detail).toBe('location=https://elsewhere.example/');
    expect(redirected.problems[0]).toBe('expected status 200, got 302');
  });

  it.each(['HIT', 'EXPIRED', 'REVALIDATED', 'UPDATING', 'hit'])('accepts a repeat /api/live answered %s', async (cf) => {
    const { results } = await run({ [`${BASE}/api/live`]: [live('MISS'), live(cf)] });
    expect(byName(results, 'GET /api/live (again)').outcome).toBe('pass');
  });

  it.each(['BYPASS', 'DYNAMIC', 'MISS'])('fails a repeat /api/live answered %s', async (cf) => {
    const { results } = await run({ [`${BASE}/api/live`]: [live('MISS'), live(cf)] });
    expect(byName(results, 'GET /api/live (again)').problems).toEqual([
      `cf-cache-status is ${cf}, expected HIT/EXPIRED/REVALIDATED/UPDATING on a repeat request`,
    ]);
  });

  it('fails /api/live with no cache status, the wrong Cache-Control or a broken body', async () => {
    const { results } = await run({
      [`${BASE}/api/live`]: [{ status: 503, headers: { 'cache-control': 'no-store' }, body: '{"error":"x"}' }, { body: 'oops' }],
    });
    expect(byName(results, 'GET /api/live').problems).toEqual([
      'expected status 200, got 503',
      `Cache-Control is "no-store", expected "${LIVE_CACHE_CONTROL}"`,
      'body is not { version, quizzes[] }',
    ]);
    expect(byName(results, 'GET /api/live').detail).toBe('cf-cache-status=(missing)');
    expect(byName(results, 'GET /api/live (again)').problems).toEqual([
      `Cache-Control is "(missing)", expected "${LIVE_CACHE_CONTROL}"`,
      'body is not { version, quizzes[] }',
      'cf-cache-status is (missing), expected HIT/EXPIRED/REVALIDATED/UPDATING on a repeat request',
    ]);
    // Nothing listed, so there is no quiz copy to check
    expect(byName(results, 'GET /api/live/quizzes/<active quiz>')).toMatchObject({ outcome: 'skip', detail: 'no active quiz in /api/live' });
  });

  it('compares Cache-Control without caring about spacing or case', async () => {
    const loose = { headers: { 'cache-control': 'Public,max-age=0,  s-maxage=5,stale-while-revalidate=5', 'cf-cache-status': 'HIT' }, body: liveBody() };
    const { results } = await run({ [`${BASE}/api/live`]: [loose, loose] });
    expect(failures(results)).toEqual([]);
  });

  it('fails when a query string reaches the app, or a 403 is not the WAF block page', async () => {
    const reachedApp = { headers: { 'content-type': 'application/json' }, body: liveBody() };
    const reached = byName((await run({ [`${BASE}/api/live?smoke=1`]: reachedApp })).results, 'GET /api/live?smoke=1');
    expect(reached.problems).toEqual(['expected status 403, got 200']);
    expect(reached.detail).toBe('content-type=application/json');
    const hostinger = await run({ [`${BASE}/api/live?smoke=1`]: { status: 403, headers: { 'content-type': 'text/html' }, body: '<h1>403 Forbidden</h1>' } });
    expect(byName(hostinger.results, 'GET /api/live?smoke=1').problems).toEqual(["the 403 is not Cloudflare's WAF block page"]);
    const noType = await run({ [`${BASE}/api/live?smoke=1`]: { status: 403 } });
    expect(byName(noType.results, 'GET /api/live?smoke=1').detail).toBe('content-type=(missing)');
  });

  it('fails a cacheable 404 for an unknown quiz', async () => {
    const { results } = await run({ [`${BASE}/api/live/quizzes/smoke-check-missing`]: { status: 404, body: '{}' } });
    expect(byName(results, 'GET /api/live/quizzes/smoke-check-missing')).toMatchObject({
      detail: 'cache-control=(missing)',
      problems: ['Cache-Control is "(missing)", expected "no-store"'],
    });
  });

  it('fails a shared quiz copy that leaks the answer key, or is not cacheable', async () => {
    const leaky = { headers: { 'cache-control': QUIZ_COPY_CACHE_CONTROL, 'cf-cache-status': 'HIT' }, body: copyBody({ id: 'q1', text: 't', options: [], correctAnswer: 1 }) };
    const { results } = await run({ [`${BASE}/api/live/quizzes/${QUIZ}`]: [leaky, { status: 200, body: '{"quiz":{"id":"other"}}' }] });
    expect(byName(results, 'GET /api/live/quizzes/<active quiz>').problems).toEqual(['answer key exposed: field "correctAnswer"']);
    expect(byName(results, 'GET /api/live/quizzes/<active quiz> (again)').problems).toEqual([
      `Cache-Control is "(missing)", expected "${QUIZ_COPY_CACHE_CONTROL}"`,
      `body is not { quiz: { id: "${QUIZ}", questions[] } }`,
      'cf-cache-status is (missing), expected HIT/EXPIRED/REVALIDATED/UPDATING on a repeat request',
    ]);
  });

  it('skips the quiz copy when no quiz is active, or the wallet state is unknown', async () => {
    const none = await run({ [`${BASE}/api/live`]: [live('MISS'), live('HIT')].map((r) => ({ ...r, body: liveBody([{ id: 'up1', status: 'upcoming' }, null]) })) });
    expect(byName(none.results, 'GET /api/live/quizzes/<active quiz>')).toMatchObject({ outcome: 'skip', status: null });
    expect(none.calls.some((c) => c.url.includes('up1'))).toBe(false);

    const unknown = await run({ [`${BASE}/api/settings/wallet-enabled`]: { status: 500, body: 'error' } });
    expect(byName(unknown.results, 'GET /api/settings/wallet-enabled')).toMatchObject({
      detail: 'walletEnabled=undefined',
      problems: ['expected status 200, got 500', 'body has no boolean walletEnabled'],
    });
    expect(byName(unknown.results, 'GET /api/live/quizzes/<active quiz>')).toMatchObject({ outcome: 'skip', detail: 'wallet state unknown' });
    // Without the wallet state, either refusal is fine for the unknown id
    expect(byName(unknown.results, 'GET /api/live/quizzes/smoke-check-missing').outcome).toBe('pass');
    const personal = { status: 403, headers: { 'cache-control': 'no-store' }, body: '{"personal":true}' };
    const unknownOn = await run({ [`${BASE}/api/settings/wallet-enabled`]: new Error('timeout'), [`${BASE}/api/live/quizzes/smoke-check-missing`]: personal });
    expect(byName(unknownOn.results, 'GET /api/live/quizzes/smoke-check-missing').outcome).toBe('pass');
  });

  it('expects personal-only refusals while the wallet is on', async () => {
    const personal = { status: 403, headers: { 'cache-control': 'no-store' }, body: '{"error":"Open this quiz from your account","personal":true}' };
    const on = await run({
      [`${BASE}/api/settings/wallet-enabled`]: { body: '{"walletEnabled":true}' },
      [`${BASE}/api/live/quizzes/smoke-check-missing`]: personal,
      [`${BASE}/api/live/quizzes/${QUIZ}`]: personal,
    });
    expect(failures(on.results)).toEqual([]);
    expect(byName(on.results, 'GET /api/live/quizzes/<active quiz>').detail).toBe(`id=${QUIZ}, cache-control=no-store`);
    expect(on.calls.filter((c) => c.url.endsWith(QUIZ))).toHaveLength(1);

    // The shared copy must not be served (or cached) while players need a day pass
    const leaking = await run({
      [`${BASE}/api/settings/wallet-enabled`]: { body: '{"walletEnabled":true}' },
      [`${BASE}/api/live/quizzes/smoke-check-missing`]: { status: 404, headers: { 'cache-control': 'no-store' } },
      [`${BASE}/api/live/quizzes/${QUIZ}`]: copy('HIT'),
    });
    expect(byName(leaking.results, 'GET /api/live/quizzes/smoke-check-missing').problems).toEqual([
      'expected status 403, got 404', '403 body lacks personal: true',
    ]);
    expect(byName(leaking.results, 'GET /api/live/quizzes/<active quiz>')).toMatchObject({
      detail: `id=${QUIZ}, cache-control=${QUIZ_COPY_CACHE_CONTROL}`,
      problems: ['expected status 403, got 200', '403 body lacks personal: true', `Cache-Control is "${QUIZ_COPY_CACHE_CONTROL}", expected "no-store"`],
    });
    const bare = await run({
      [`${BASE}/api/settings/wallet-enabled`]: { body: '{"walletEnabled":true}' },
      [`${BASE}/api/live/quizzes/smoke-check-missing`]: personal,
      [`${BASE}/api/live/quizzes/${QUIZ}`]: { status: 403, body: '{"personal":true}' },
    });
    expect(byName(bare.results, 'GET /api/live/quizzes/<active quiz>').detail).toBe(`id=${QUIZ}, cache-control=(missing)`);
  });

  it('fails an unhealthy health probe and a missing or wrong www redirect', async () => {
    const { results } = await run({
      [`${BASE}/api/health`]: { status: 503, body: '{"status":"degraded"}' },
      'https://www.1think2win.com/': { status: 200, body: 'hello' },
    });
    expect(byName(results, 'GET /api/health').problems).toEqual(['expected status 200, got 503', 'body status is "degraded", expected "ok"']);
    expect(byName(results, 'GET https://www.1think2win.com/')).toMatchObject({
      detail: 'location=(missing)',
      problems: ['expected status 301, got 200', `location is (missing), expected ${BASE}/`],
    });
    const blank = await run({ [`${BASE}/api/health`]: { body: 'not json' } });
    expect(byName(blank.results, 'GET /api/health').problems).toEqual(['body status is (missing), expected "ok"']);
  });

  it('reports a request that never got an answer', async () => {
    const { results } = await run({ [`${BASE}/`]: new Error('The operation timed out.') });
    expect(byName(results, 'GET /')).toMatchObject({ outcome: 'fail', status: null, problems: ['request failed: The operation timed out.'] });
    const noLive = await run({ [`${BASE}/api/live`]: [new Error('connection reset'), live('HIT')] });
    expect(byName(noLive.results, 'GET /api/live').problems).toEqual(['request failed: connection reset']);
    expect(byName(noLive.results, 'GET /api/live/quizzes/<active quiz>').outcome).toBe('skip');
    // Not every thrown value is an Error
    const site = fakeSite();
    const odd: Fetcher = (url, init) => (url.endsWith('/api/health') ? Promise.reject('socket hang up') : site.fetcher(url, init));
    const health = byName(await runSmoke(options, odd), 'GET /api/health');
    expect(health.problems).toEqual(['request failed: socket hang up']);
  });

  it('skips the www check when there is no www host', async () => {
    const { results, calls } = await run({}, { wwwUrl: null });
    expect(byName(results, 'GET www redirect')).toMatchObject({ outcome: 'skip', detail: 'no www host for this base URL' });
    expect(calls.some((c) => c.url.includes('www.'))).toBe(false);
  });

  it('hands each result to the reporter as soon as it is known', async () => {
    const site = fakeSite();
    const seen: string[] = [];
    const tracking: Fetcher = (url, init) => {
      seen.push(`request ${url}`);
      return site.fetcher(url, init);
    };
    const results = await runSmoke(options, tracking, (r) => seen.push(`result ${r.name}`));
    expect(seen.filter((s) => s.startsWith('result'))).toHaveLength(results.length);
    // The home page line is printed before /api/live is even requested
    expect(seen.slice(0, 3)).toEqual([`request ${BASE}/`, 'result GET /', `request ${BASE}/api/live`]);
  });
});

describe('parseSmokeArgs', () => {
  it('defaults to production with its www redirect', () => {
    expect(parseSmokeArgs([], {})).toEqual({ baseUrl: BASE, wwwUrl: 'https://www.1think2win.com/', pauseMs: 300, timeoutMs: 15_000 });
  });

  it('takes the base from --base or SMOKE_BASE_URL, flag first', () => {
    expect(parseSmokeArgs([], { SMOKE_BASE_URL: 'https://staging.1think2win.com/' }).baseUrl).toBe('https://staging.1think2win.com');
    expect(parseSmokeArgs(['--base', 'http://localhost:3000'], { SMOKE_BASE_URL: 'https://x.example' }).baseUrl).toBe('http://localhost:3000');
  });

  it('checks www only for an apex host unless told otherwise', () => {
    expect(parseSmokeArgs(['--base', 'https://staging.1think2win.com'], {}).wwwUrl).toBeNull();
    expect(parseSmokeArgs(['--base', 'http://localhost:3000'], {}).wwwUrl).toBeNull();
    expect(parseSmokeArgs(['--base', 'http://example.com:8080'], {}).wwwUrl).toBe('http://www.example.com:8080/');
    expect(parseSmokeArgs(['--skip-www'], {}).wwwUrl).toBeNull();
    expect(parseSmokeArgs([], { SMOKE_WWW_URL: 'skip' }).wwwUrl).toBeNull();
    expect(parseSmokeArgs(['--www', 'https://www.staging.example.com'], {}).wwwUrl).toBe('https://www.staging.example.com/');
    expect(parseSmokeArgs([], { SMOKE_WWW_URL: 'https://www.1think2win.com' }).wwwUrl).toBe('https://www.1think2win.com/');
  });

  it('rejects bad input with a readable message', () => {
    expect(() => parseSmokeArgs(['--base'], {})).toThrow('--base needs a URL');
    expect(() => parseSmokeArgs(['--www', '--skip-www'], {})).toThrow('--www needs a URL');
    expect(() => parseSmokeArgs(['--verbose'], {})).toThrow('Unknown option --verbose');
    expect(() => parseSmokeArgs(['--base', '1think2win.com'], {})).toThrow('is not a URL');
    expect(() => parseSmokeArgs(['--base', 'ftp://1think2win.com'], {})).toThrow('use an http(s) URL');
    expect(() => parseSmokeArgs(['--base', 'https://1think2win.com/api'], {})).toThrow("origin only");
    expect(() => parseSmokeArgs(['--www', 'https://www.1think2win.com/?x=1'], {})).toThrow("origin only");
  });
});

describe('formatResult and summarize', () => {
  const pass: CheckResult = { name: 'GET /api/health', outcome: 'pass', status: 200, detail: 'status=ok', problems: [] };
  const fail: CheckResult = { name: 'GET /', outcome: 'fail', status: null, detail: '', problems: ['request failed: timeout', 'second'] };
  const skipped: CheckResult = { name: 'GET www redirect', outcome: 'skip', status: null, detail: 'no www host', problems: [] };

  it('prints outcome, status, name and key header on one line, problems below', () => {
    expect(formatResult(pass)).toBe(`PASS  200  ${'GET /api/health'.padEnd(44)}  status=ok`);
    expect(formatResult(fail)).toBe('FAIL  ---  GET /\n      request failed: timeout\n      second');
    expect(formatResult(skipped)).toMatch(/^SKIP  ---  GET www redirect/);
  });

  it('counts outcomes and lists every failure', () => {
    expect(summarize([pass, skipped])).toEqual({ failed: [], text: '1 passed, 0 failed, 1 skipped' });
    expect(summarize([pass, fail, skipped])).toEqual({
      failed: [fail],
      text: '1 passed, 1 failed, 1 skipped\nFailed checks:\n  - GET /: request failed: timeout\n  - GET /: second',
    });
  });
});
