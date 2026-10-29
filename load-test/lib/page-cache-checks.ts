/**
 * Checks for Cloudflare's page cache (the CLI is load-test/page-cache.ts, the rule and why it looks the
 * way it does are in deploy/CLOUDFLARE_PAGE_CACHE.md).
 *
 * The Cache Rule serves the public prerendered pages, and Next's prefetches of them, to visitors without
 * a Supabase session cookie. These checks prove that it does, that each cached copy is the build the
 * origin runs now (a stale one points at deleted JS chunks), and that nothing personal comes from the
 * cache. They also check that the home page's pictures are static files Cloudflare caches, not
 * /_next/image (resized on Hostinger, never cached), that the leaderboard API and the manifest come from
 * the cache, and that an ad landing (?utm_…) gets the cached page while any other query string does not.
 * Like the smoke check: one request at a time (36), no sign-in, no writes, no secrets.
 */
import {
  CACHED_STATUSES, PRODUCTION_URL, cacheStatus, check, expectCacheControl, expectCached, expectStatus, parseOrigin, probe,
  type CheckResult, type Fetcher, type Probe,
} from './smoke-checks';

/** The pages the Cache Rule covers: prerendered, the same HTML for everyone (personal data loads in the browser). */
export const CACHED_PAGES = ['/', '/faq', '/how-to-play', '/prizes', '/leaderboard', '/terms', '/privacy', '/disclaimer', '/contact'];
/** What Next sends for a prerendered page. A browser max-age here would keep old HTML after a deploy. */
export const PAGE_CACHE_CONTROL = 's-maxage=31536000';
/** Routes the rule must leave alone, with the status an anonymous visitor gets. */
export const UNCACHED_PATHS: Record<string, number> = { '/quizzes': 307, '/login': 307, '/auth': 200, '/api/health': 200 };
/** A query string keeps a page out of the cache, so this always reaches Hostinger: the build the origin runs. */
export const ORIGIN_PROBE = '/?page-cache-check=1';
/** The tree prefetch of /faq that the home page sends (lowercase names, as the probe expects). */
export const PREFETCH_HEADERS: Record<string, string> = {
  rsc: '1',
  'next-router-prefetch': '1',
  'next-router-segment-prefetch': '/_tree',
  'next-url': '/',
};
/** Shaped like a Supabase session cookie (no project has this ref). The rule leaves such requests to the origin. */
export const SESSION_COOKIE = 'sb-pagecachecheck-auth-token=1';
/** Cloudflare's answer when the request was never eligible for its cache, or the origin said no. */
const NOT_CACHED_STATUSES = ['DYNAMIC', 'BYPASS'];
/** A pre-sized ball picture in the home page HTML (src/components/hero/SportsBall.tsx). */
const STATIC_BALL_IMAGE = /\/images\/sports\/[a-z]+-\d+\.avif/;
/** What next.config.js sends for the manifest: browsers fetch it on most page loads. */
export const MANIFEST_CACHE_CONTROL = 'public, max-age=86400';
/** Shared JSON the cache rules in deploy/cloudflare-{leaderboard,manifest}-cache-rule.json cover. */
export const LEADERBOARD_PATH = '/api/leaderboard';
export const MANIFEST_PATH = '/manifest.json';
/** Tracking parameters only: the rewrite rule (deploy/cloudflare-tracking-query-rewrite-rule.json) drops them. */
export const AD_LANDING = '/?utm_source=cache-check&utm_medium=test';
/** One parameter that isn't tracking keeps the whole query string, so this one reaches Hostinger. */
export const MIXED_LANDING = '/?ref=cache-check&utm_source=cache-check';

export interface PageCacheOptions {
  baseUrl: string;
  /** Purge Cloudflare's cache (after a deploy) before checking. */
  purge: boolean;
  /** Purge even when Cloudflare already serves the origin's build. */
  force: boolean;
  pauseMs: number;
  timeoutMs: number;
}

export interface CloudflareCredentials {
  zoneId: string;
  apiToken: string;
}

export const USAGE = `Usage: bun load-test/page-cache.ts [--base URL] [--purge [--force]]

  (no option)   check that Cloudflare serves the public pages from its cache, the origin's
                current build, and nothing personal (bun run cache:check)
  --purge       after a deploy: Purge Everything, then check (bun run cache:purge). Needs
                CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN (a token with only Zone > Cache Purge),
                kept in the git-ignored .env.cloudflare, never in .env
  --force       purge even when Cloudflare already serves the origin's build
  --base URL    site to check (env SMOKE_BASE_URL, default ${PRODUCTION_URL})`;

/** Options from the command line and environment. Throws with a readable message on bad input. */
export function parsePageCacheArgs(argv: string[], env: Record<string, string | undefined>): PageCacheOptions {
  let base = env.SMOKE_BASE_URL || PRODUCTION_URL;
  let purge = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--purge') {
      purge = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--base') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`--base needs a URL\n\n${USAGE}`);
      base = value;
    } else {
      throw new Error(`Unknown option ${arg}\n\n${USAGE}`);
    }
  }
  if (force && !purge) throw new Error(`--force only goes with --purge\n\n${USAGE}`);
  return { baseUrl: parseOrigin(base, '--base'), purge, force, pauseMs: 300, timeoutMs: 15_000 };
}

/** The purge credentials from the environment. Throws, naming what is missing, if either is unset. */
export function cloudflareCredentials(env: Record<string, string | undefined>): CloudflareCredentials {
  const zoneId = env.CLOUDFLARE_ZONE_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const missing = [!zoneId && 'CLOUDFLARE_ZONE_ID', !apiToken && 'CLOUDFLARE_API_TOKEN'].filter(Boolean);
  if (missing.length) {
    throw new Error(`--purge needs ${missing.join(' and ')}: put them in .env.cloudflare (git-ignored) and run bun run cache:purge`);
  }
  return { zoneId: zoneId!, apiToken: apiToken! };
}

/**
 * Next's `_rsc` value for these request headers: the first 12 bytes of a SHA-256, base64url. Next answers
 * a request whose `_rsc` does not match its headers with a 307, so the URL alone tells responses apart
 * (next/dist/shared/lib/router/utils/cache-busting-search-param.js).
 */
export async function rscSearchParam(headers: Record<string, string>): Promise<string> {
  const input = ['next-router-prefetch', 'next-router-segment-prefetch', 'next-router-state-tree', 'next-url']
    .map((name) => headers[name] ?? '0')
    .join(',');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
  return btoa(String.fromCharCode(...digest.subarray(0, 12))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The build a page or prefetch came from: `"b":"…"` in page HTML (escaped in a script), `"buildId":"…"` in a prefetch. */
export function buildIdOf(body: string): string | null {
  return /\\?"(?:b|buildId)\\?":\\?"([\w-]{8,})\\?"/.exec(body)?.[1] ?? null;
}

const isCached = (res: Probe) => CACHED_STATUSES.includes((res.headers.get('cf-cache-status') ?? '').toUpperCase());

function expectNotCached(res: Probe, problems: string[]) {
  const status = (res.headers.get('cf-cache-status') ?? '').toUpperCase();
  if (!NOT_CACHED_STATUSES.includes(status)) {
    problems.push(`cf-cache-status is ${status || '(missing)'}, expected ${NOT_CACHED_STATUSES.join('/')}: the page cache must not answer this`);
  }
}

function expectContentType(res: Probe, expected: string, problems: string[]) {
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith(expected)) problems.push(`content-type is ${type || '(missing)'}, expected ${expected}`);
}

function expectBuild(res: Probe, originBuild: string | null, problems: string[]) {
  const build = buildIdOf(res.body);
  if (!build) problems.push('no build ID in the body (not the app?)');
  else if (originBuild && build !== originBuild) {
    problems.push(`build ${build} is not the origin's ${originBuild}: purge the cache (bun run cache:purge)`);
  }
}

function checkOrigin(res: Probe | Error) {
  return check(`GET ${ORIGIN_PROBE} (origin's build)`, res, (page, problems) => {
    expectStatus(page, 200, problems);
    expectNotCached(page, problems);
    const build = buildIdOf(page.body);
    if (!build) problems.push('no build ID in the HTML (not the app?)');
    return `build=${build ?? '(none)'}, ${cacheStatus(page)}`;
  });
}

/** The second of two requests: a cached copy of the origin's current build, with nothing for the browser to keep. */
function checkCachedTwice(name: string, first: Probe | Error, second: Probe | Error, contentType: string, originBuild: string | null) {
  if (first instanceof Error) return check(name, first, () => '');
  return check(name, second, (res, problems) => {
    expectStatus(first, 200, problems);
    expectStatus(res, 200, problems);
    expectContentType(res, contentType, problems);
    expectCacheControl(res, PAGE_CACHE_CONTROL, problems);
    if (res.headers.has('set-cookie')) problems.push('a cached response sets a cookie');
    expectCached(res, problems);
    expectBuild(res, originBuild, problems);
    return `${first.headers.get('cf-cache-status') ?? '(missing)'} then ${cacheStatus(res)}, build=${buildIdOf(res.body) ?? '(none)'}`;
  });
}

/** A response that must come from the origin, never the page cache. */
function checkNotCached(name: string, res: Probe | Error, status: number, contentType?: string) {
  return check(name, res, (page, problems) => {
    expectStatus(page, status, problems);
    if (contentType) expectContentType(page, contentType, problems);
    expectNotCached(page, problems);
    const location = page.headers.get('location');
    return location ? `${cacheStatus(page)}, location=${location}` : cacheStatus(page);
  });
}

/** The home page loads no picture through Next's optimizer, and names the static ones it uses instead. */
function checkHomeImages(home: Probe | Error) {
  return check('GET / pictures are static files', home, (page, problems) => {
    if (page.body.includes('/_next/image')) {
      problems.push('the home page loads pictures through /_next/image: Hostinger resizes each one, and Cloudflare never caches it');
    }
    const image = STATIC_BALL_IMAGE.exec(page.body)?.[0];
    if (!image) problems.push('no pre-sized ball picture (/images/sports/<ball>-<width>.avif) in the home page');
    return image ?? '(none)';
  });
}

/** A file asked for twice: the second answer comes from Cloudflare's cache (and has `cacheControl`, if given). */
function checkRepeatCached(name: string, first: Probe | Error, second: Probe | Error, contentType: string, cacheControl?: string) {
  if (first instanceof Error) return check(name, first, () => '');
  return check(name, second, (res, problems) => {
    expectStatus(first, 200, problems);
    expectStatus(res, 200, problems);
    expectContentType(res, contentType, problems);
    if (cacheControl) expectCacheControl(res, cacheControl, problems);
    expectCached(res, problems);
    return `${first.headers.get('cf-cache-status') ?? '(missing)'} then ${cacheStatus(res)}`;
  });
}

/** Read the origin's build (through a URL the cache never answers) and what Cloudflare serves for `/`. */
export async function readBuilds(options: PageCacheOptions, fetcher: Fetcher = fetch) {
  const origin = await probe(fetcher, `${options.baseUrl}${ORIGIN_PROBE}`, options.timeoutMs);
  if (options.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, options.pauseMs));
  const edge = await probe(fetcher, `${options.baseUrl}/`, options.timeoutMs);
  return { origin, edge };
}

export type PurgeDecision = { purge: boolean; reason: string };

/**
 * Purge only once the deploy is live. When Cloudflare's cached `/` already is the build the origin serves,
 * the new build has not started yet, and purging now would refill the cache with the old pages.
 */
export function decidePurge(origin: Probe | Error, edge: Probe | Error, force: boolean): PurgeDecision {
  if (origin instanceof Error) {
    return { purge: force, reason: `could not read the origin's build: ${origin.message}` };
  }
  const originBuild = buildIdOf(origin.body);
  if (origin.status !== 200 || !originBuild) {
    return { purge: force, reason: `the origin answered ${origin.status} without a build ID (not the app?)` };
  }
  if (edge instanceof Error) return { purge: true, reason: `origin serves build ${originBuild}; Cloudflare's copy unreadable (${edge.message})` };
  const edgeBuild = buildIdOf(edge.body);
  if (isCached(edge) && edgeBuild === originBuild) {
    return {
      purge: force,
      reason: `Cloudflare already serves build ${originBuild}, the one the origin runs. If you just deployed, it is not live yet: ` +
        'wait until hPanel shows the deployment finished, then run this again (or pass --force)',
    };
  }
  return { purge: true, reason: `origin serves build ${originBuild}; Cloudflare had ${edgeBuild ?? '(none)'} (${cacheStatus(edge)})` };
}

/** Purge Everything on the zone. Throws with Cloudflare's errors (never the token) when it fails. */
export async function purgeEverything(credentials: CloudflareCredentials, fetcher: Fetcher = fetch, timeoutMs = 15_000) {
  const url = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(credentials.zoneId)}/purge_cache`;
  const res = await fetcher(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${credentials.apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ purge_everything: true }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => null) as { success?: boolean; errors?: { code: number; message: string }[] } | null;
  if (!res.ok || body?.success !== true) {
    const errors = body?.errors?.map((e) => `${e.code} ${e.message}`).join('; ') || 'no details';
    throw new Error(`Cloudflare purge failed (HTTP ${res.status}): ${errors}`);
  }
}

/**
 * Run every check, one request at a time, and hand each result to `report` as soon as it is known. The
 * prefetch is checked before the same URL without its RSC header, which must still get HTML from the
 * origin: proof that no one can store a page under a prefetch's cache key, or the other way round.
 */
export async function runPageCacheChecks(
  options: PageCacheOptions,
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
  const get = async (url: string, headers?: Record<string, string>) => {
    if (requests++ > 0 && options.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, options.pauseMs));
    return probe(fetcher, url, options.timeoutMs, headers);
  };

  const origin = await get(`${base}${ORIGIN_PROBE}`);
  add(checkOrigin(origin));
  const originBuild = origin instanceof Error ? null : buildIdOf(origin.body);

  let home: Probe | Error = new Error('the home page was not fetched');
  for (const path of CACHED_PAGES) {
    const first = await get(`${base}${path}`);
    const second = await get(`${base}${path}`);
    if (path === '/') home = second;
    add(checkCachedTwice(`GET ${path} (twice)`, first, second, 'text/html', originBuild));
  }

  const prefetchUrl = `${base}/faq?_rsc=${await rscSearchParam(PREFETCH_HEADERS)}`;
  const first = await get(prefetchUrl, PREFETCH_HEADERS);
  add(checkCachedTwice('GET /faq?_rsc= (prefetch, twice)', first, await get(prefetchUrl, PREFETCH_HEADERS), 'text/x-component', originBuild));
  add(checkNotCached('GET /faq?_rsc= without the RSC header', await get(prefetchUrl), 200, 'text/html'));
  add(checkNotCached('GET /faq with a session cookie', await get(`${base}/faq`, { cookie: SESSION_COOKIE }), 200, 'text/html'));

  for (const [path, status] of Object.entries(UNCACHED_PATHS)) {
    add(checkNotCached(`GET ${path}`, await get(`${base}${path}`), status));
  }

  add(checkHomeImages(home));
  const image = home instanceof Error ? undefined : STATIC_BALL_IMAGE.exec(home.body)?.[0];
  if (image) {
    const firstImage = await get(`${base}${image}`);
    add(checkRepeatCached(`GET ${image} (twice)`, firstImage, await get(`${base}${image}`), 'image/avif'));
  }

  const firstBoard = await get(`${base}${LEADERBOARD_PATH}`);
  add(checkRepeatCached(`GET ${LEADERBOARD_PATH} (twice)`, firstBoard, await get(`${base}${LEADERBOARD_PATH}`), 'application/json'));
  const firstManifest = await get(`${base}${MANIFEST_PATH}`);
  add(checkRepeatCached(`GET ${MANIFEST_PATH} (twice)`, firstManifest, await get(`${base}${MANIFEST_PATH}`), 'application/', MANIFEST_CACHE_CONTROL));

  const firstLanding = await get(`${base}${AD_LANDING}`);
  add(checkCachedTwice(`GET ${AD_LANDING} (ad landing, twice)`, firstLanding, await get(`${base}${AD_LANDING}`), 'text/html', originBuild));
  add(checkNotCached(`GET ${MIXED_LANDING}`, await get(`${base}${MIXED_LANDING}`), 200, 'text/html'));
  return results;
}
