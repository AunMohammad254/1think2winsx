/**
 * Post-deploy smoke checks for the public site (the CLI is load-test/smoke.ts).
 *
 * Kept tiny on purpose: Hostinger's abuse protection answers the whole site with 403 at about
 * 100 req/s, so the checks run one request at a time, about ten per run, with no sign-in, no writes
 * and no secrets. Each check looks at the content as well as the status: a DNS rollback once served
 * Hostinger's "Parked Domain" page with status 200.
 */

export const PRODUCTION_URL = 'https://1think2win.com';
export const EXPECTED_TITLE = '1Think 2Win';
export const LIVE_CACHE_CONTROL = 'public, max-age=0, s-maxage=5, stale-while-revalidate=5';
export const QUIZ_COPY_CACHE_CONTROL = 'public, max-age=0, s-maxage=10, stale-while-revalidate=10';
export const MISSING_QUIZ_ID = 'smoke-check-missing';

// The second of two requests seconds apart must come from Cloudflare's cache. EXPIRED, REVALIDATED and
// UPDATING are still cached copies; BYPASS, DYNAMIC, MISS or no header mean the Cache Rule did not apply
const CACHED_STATUSES = ['HIT', 'EXPIRED', 'REVALIDATED', 'UPDATING'];
// Cloudflare's WAF block page; a 403 without it comes from somewhere else (e.g. Hostinger)
const CLOUDFLARE_BLOCK_PAGE = /you have been blocked|Attention Required! \| Cloudflare/i;
// Cloudflare tells crawlers apart by user agent; this one says what is knocking in the logs
const USER_AGENT = '1think2win-smoke/1 (load-test/smoke.ts)';

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface SmokeOptions {
  /** The site's origin, without a trailing slash. */
  baseUrl: string;
  /** The www host that must redirect to `baseUrl`, or null to skip that check. */
  wwwUrl: string | null;
  /** Pause between requests, so a run never looks like a burst. */
  pauseMs: number;
  timeoutMs: number;
}

export interface CheckResult {
  name: string;
  outcome: 'pass' | 'fail' | 'skip';
  status: number | null;
  /** The key header or value, shown on every line. */
  detail: string;
  problems: string[];
}

interface Probe {
  status: number;
  headers: Headers;
  body: string;
}

export const USAGE = `Usage: bun load-test/smoke.ts [--base URL] [--www URL | --skip-www]

  --base URL    site to check (env SMOKE_BASE_URL, default ${PRODUCTION_URL})
  --www URL     www address that must 301 to the base (env SMOKE_WWW_URL); by default
                https://www.<host>/ for an apex host like example.com, skipped otherwise
  --skip-www    skip the www redirect check (or SMOKE_WWW_URL=skip)`;

function parseOrigin(raw: string, flag: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${flag}: "${raw}" is not a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${flag}: use an http(s) URL`);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error(`${flag}: pass the site's origin only, e.g. ${PRODUCTION_URL}`);
  return url.origin;
}

/** Options from the command line and environment. Throws with a readable message on bad input. */
export function parseSmokeArgs(argv: string[], env: Record<string, string | undefined>): SmokeOptions {
  let base = env.SMOKE_BASE_URL || PRODUCTION_URL;
  let www = env.SMOKE_WWW_URL || undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-www') {
      www = 'skip';
    } else if (arg === '--base' || arg === '--www') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a URL\n\n${USAGE}`);
      if (arg === '--base') base = value;
      else www = value;
    } else {
      throw new Error(`Unknown option ${arg}\n\n${USAGE}`);
    }
  }

  const baseUrl = parseOrigin(base, '--base');
  let wwwUrl: string | null;
  if (www === 'skip') {
    wwwUrl = null;
  } else if (www) {
    wwwUrl = `${parseOrigin(www, '--www')}/`;
  } else {
    // Only an apex host (example.com) has a www twin to check; staging.example.com or localhost do not
    const { protocol, host, hostname } = new URL(baseUrl);
    wwwUrl = hostname.split('.').length === 2 ? `${protocol}//www.${host}/` : null;
  }
  return { baseUrl, wwwUrl, pauseMs: 300, timeoutMs: 15_000 };
}

async function probe(fetcher: Fetcher, url: string, timeoutMs: number): Promise<Probe | Error> {
  try {
    const res = await fetcher(url, {
      // A redirect is never expected except from www, and following one would hide where it went
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, headers: res.headers, body: await res.text() };
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function json(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

const normaliseCacheControl = (value: string | null) =>
  (value ?? '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean).join(', ');

function expectStatus(res: Probe, expected: number, problems: string[]) {
  if (res.status !== expected) problems.push(`expected status ${expected}, got ${res.status}`);
}

function expectCacheControl(res: Probe, expected: string, problems: string[]) {
  const actual = res.headers.get('cache-control');
  if (normaliseCacheControl(actual) !== expected) problems.push(`Cache-Control is "${actual ?? '(missing)'}", expected "${expected}"`);
}

function expectCached(res: Probe, problems: string[]) {
  const status = res.headers.get('cf-cache-status');
  if (!status || !CACHED_STATUSES.includes(status.toUpperCase())) {
    problems.push(`cf-cache-status is ${status ?? '(missing)'}, expected ${CACHED_STATUSES.join('/')} on a repeat request`);
  }
}

const cacheStatus = (res: Probe) => `cf-cache-status=${res.headers.get('cf-cache-status') ?? '(missing)'}`;

/** The first key anywhere in a JSON value that matches `pattern`. */
function findKey(value: unknown, pattern: RegExp): string | null {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (pattern.test(key)) return key;
    const found = findKey(child, pattern);
    if (found) return found;
  }
  return null;
}

/** Run `verify` on a response; a failed request (timeout, DNS, TLS) is a failed check. */
function check(name: string, res: Probe | Error, verify: (res: Probe, problems: string[]) => string): CheckResult {
  if (res instanceof Error) {
    return { name, outcome: 'fail', status: null, detail: '', problems: [`request failed: ${res.message}`] };
  }
  const problems: string[] = [];
  const detail = verify(res, problems);
  return { name, outcome: problems.length ? 'fail' : 'pass', status: res.status, detail, problems };
}

const skip = (name: string, detail: string): CheckResult => ({ name, outcome: 'skip', status: null, detail, problems: [] });

function checkHome(res: Probe | Error) {
  return check('GET /', res, (page, problems) => {
    expectStatus(page, 200, problems);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.body)?.[1].trim();
    if (title !== EXPECTED_TITLE) problems.push(`title is ${title === undefined ? '(missing)' : `"${title}"`}, expected "${EXPECTED_TITLE}"`);
    if (/parked/i.test(page.body)) problems.push('page mentions "parked": a parked-domain page, not the app');
    const location = page.headers.get('location');
    return location ? `location=${location}` : `title="${title ?? ''}"`;
  });
}

function checkLive(name: string, res: Probe | Error, repeat: boolean) {
  return check(name, res, (live, problems) => {
    expectStatus(live, 200, problems);
    expectCacheControl(live, LIVE_CACHE_CONTROL, problems);
    const body = json(live.body);
    if (typeof body?.version !== 'string' || !Array.isArray(body?.quizzes)) problems.push('body is not { version, quizzes[] }');
    if (repeat) expectCached(live, problems);
    return Array.isArray(body?.quizzes) ? `${cacheStatus(live)}, ${body.quizzes.length} quizzes` : cacheStatus(live);
  });
}

function checkQueryBlocked(res: Probe | Error) {
  return check('GET /api/live?smoke=1', res, (blocked, problems) => {
    expectStatus(blocked, 403, problems);
    const fromCloudflare = CLOUDFLARE_BLOCK_PAGE.test(blocked.body);
    if (blocked.status === 403 && !fromCloudflare) problems.push("the 403 is not Cloudflare's WAF block page");
    return fromCloudflare ? 'blocked by the Cloudflare WAF rule' : `content-type=${blocked.headers.get('content-type') ?? '(missing)'}`;
  });
}

function checkWallet(res: Probe | Error): { result: CheckResult; walletEnabled: boolean | null } {
  let walletEnabled: boolean | null = null;
  const result = check('GET /api/settings/wallet-enabled', res, (wallet, problems) => {
    expectStatus(wallet, 200, problems);
    const value = json(wallet.body)?.walletEnabled;
    if (typeof value === 'boolean') walletEnabled = value;
    else problems.push('body has no boolean walletEnabled');
    return `walletEnabled=${value}`;
  });
  return { result, walletEnabled };
}

/** With the wallet on, the shared quiz copy refuses every id and sends players to their account. */
function expectPersonalOnly(res: Probe, problems: string[]) {
  expectStatus(res, 403, problems);
  if (json(res.body)?.personal !== true) problems.push('403 body lacks personal: true');
}

function checkMissingQuiz(res: Probe | Error, walletEnabled: boolean | null) {
  return check(`GET /api/live/quizzes/${MISSING_QUIZ_ID}`, res, (missing, problems) => {
    if (walletEnabled === true || (walletEnabled === null && missing.status === 403)) expectPersonalOnly(missing, problems);
    else expectStatus(missing, 404, problems);
    expectCacheControl(missing, 'no-store', problems);
    return `cache-control=${missing.headers.get('cache-control') ?? '(missing)'}`;
  });
}

/** The first active quiz in an /api/live answer, if it had one. */
function activeQuizId(live: Probe | Error): string | null {
  if (live instanceof Error) return null;
  const quizzes = json(live.body)?.quizzes;
  const quiz = Array.isArray(quizzes) ? quizzes.find((q) => q?.status === 'active' && typeof q.id === 'string') : undefined;
  return quiz?.id ?? null;
}

function checkQuizCopy(name: string, res: Probe | Error, id: string, repeat: boolean) {
  return check(name, res, (copy, problems) => {
    expectStatus(copy, 200, problems);
    expectCacheControl(copy, QUIZ_COPY_CACHE_CONTROL, problems);
    const body = json(copy.body);
    if (body?.quiz?.id !== id || !Array.isArray(body.quiz.questions)) problems.push(`body is not { quiz: { id: "${id}", questions[] } }`);
    // The answer key is a field (correctAnswer); question text may well say "correct"
    const leaked = findKey(body, /correct/i);
    if (leaked) problems.push(`answer key exposed: field "${leaked}"`);
    if (repeat) expectCached(copy, problems);
    return repeat ? cacheStatus(copy) : `id=${id}, ${cacheStatus(copy)}`;
  });
}

function checkHealth(res: Probe | Error) {
  return check('GET /api/health', res, (health, problems) => {
    expectStatus(health, 200, problems);
    const status = json(health.body)?.status;
    if (status !== 'ok') problems.push(`body status is ${status === undefined ? '(missing)' : `"${status}"`}, expected "ok"`);
    return `status=${status}`;
  });
}

function checkWww(res: Probe | Error, wwwUrl: string, target: string) {
  return check(`GET ${wwwUrl}`, res, (redirect, problems) => {
    expectStatus(redirect, 301, problems);
    const location = redirect.headers.get('location');
    if (location !== target) problems.push(`location is ${location ?? '(missing)'}, expected ${target}`);
    return `location=${location ?? '(missing)'}`;
  });
}

/**
 * Run every check, one request at a time (about ten requests), and hand each result to `report` as
 * soon as it is known.
 */
export async function runSmoke(
  options: SmokeOptions,
  fetcher: Fetcher = fetch,
  report: (result: CheckResult) => void = () => {}
): Promise<CheckResult[]> {
  const base = options.baseUrl;
  const results: CheckResult[] = [];
  const add = (result: CheckResult) => {
    results.push(result);
    report(result);
  };
  let requests = 0;
  const get = async (url: string) => {
    if (requests++ > 0 && options.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, options.pauseMs));
    return probe(fetcher, url, options.timeoutMs);
  };

  add(checkHome(await get(`${base}/`)));

  const live = await get(`${base}/api/live`);
  add(checkLive('GET /api/live', live, false));
  add(checkLive('GET /api/live (again)', await get(`${base}/api/live`), true));
  add(checkQueryBlocked(await get(`${base}/api/live?smoke=1`)));

  const { result: walletResult, walletEnabled } = checkWallet(await get(`${base}/api/settings/wallet-enabled`));
  add(walletResult);
  add(checkMissingQuiz(await get(`${base}/api/live/quizzes/${MISSING_QUIZ_ID}`), walletEnabled));

  const copyName = 'GET /api/live/quizzes/<active quiz>';
  const id = activeQuizId(live);
  if (walletEnabled === null) {
    add(skip(copyName, 'wallet state unknown'));
  } else if (!id) {
    add(skip(copyName, 'no active quiz in /api/live'));
  } else if (walletEnabled) {
    add(check(copyName, await get(`${base}/api/live/quizzes/${encodeURIComponent(id)}`), (copy, problems) => {
      expectPersonalOnly(copy, problems);
      expectCacheControl(copy, 'no-store', problems);
      return `id=${id}, cache-control=${copy.headers.get('cache-control') ?? '(missing)'}`;
    }));
  } else {
    const url = `${base}/api/live/quizzes/${encodeURIComponent(id)}`;
    add(checkQuizCopy(copyName, await get(url), id, false));
    add(checkQuizCopy(`${copyName} (again)`, await get(url), id, true));
  }

  // The plain liveness probe: never ?stats=1 or ?deep=1, which need the CRON_SECRET
  add(checkHealth(await get(`${base}/api/health`)));

  if (options.wwwUrl) add(checkWww(await get(options.wwwUrl), options.wwwUrl, `${base}/`));
  else add(skip('GET www redirect', 'no www host for this base URL'));

  return results;
}

/** One line per check: outcome, status, name, key header, and what went wrong. */
export function formatResult(result: CheckResult): string {
  const line = `${result.outcome.toUpperCase().padEnd(4)}  ${String(result.status ?? '---').padEnd(3)}  ${result.name.padEnd(44)}  ${result.detail}`.trimEnd();
  return result.problems.length ? `${line}\n      ${result.problems.join('\n      ')}` : line;
}

export function summarize(results: CheckResult[]): { failed: CheckResult[]; text: string } {
  const failed = results.filter((r) => r.outcome === 'fail');
  const count = (outcome: CheckResult['outcome']) => results.filter((r) => r.outcome === outcome).length;
  const totals = `${count('pass')} passed, ${failed.length} failed, ${count('skip')} skipped`;
  if (!failed.length) return { failed, text: totals };
  const lines = failed.flatMap((r) => r.problems.map((problem) => `  - ${r.name}: ${problem}`));
  return { failed, text: `${totals}\nFailed checks:\n${lines.join('\n')}` };
}
