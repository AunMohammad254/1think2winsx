// @vitest-environment node
import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  buildIdOf, cloudflareCredentials, decidePurge, parsePageCacheArgs, purgeEverything, rscSearchParam, runPageCacheChecks,
  AD_LANDING, CACHED_PAGES, FAVICON_PATH, LEADERBOARD_PATH, MANIFEST_CACHE_CONTROL, MANIFEST_PATH, MIXED_LANDING, ORIGIN_PROBE, PAGE_CACHE_CONTROL,
  PREFETCH_HEADERS, UNCACHED_PATHS, type PageCacheOptions,
} from './page-cache-checks';
import type { CheckResult, Fetcher, Probe } from './smoke-checks';

const BASE = 'https://1think2win.com';
const BUILD = 'OsLjE9ZrZ4Da05OFkff1u';
const OLD_BUILD = 'lEU2vjnN4HW8Hp574kpPD';
// The _rsc value the home page used for this prefetch on 2026-10-21
const PREFETCH_URL = `${BASE}/faq?_rsc=5CB68i4pnAekjehf`;
const options: PageCacheOptions = { baseUrl: BASE, purge: false, force: false, pauseMs: 0, timeoutMs: 1_000 };

type Route = { status?: number; headers?: Record<string, string>; body?: string } | Error;

// How production embeds the build: escaped inside a script in the HTML, plain JSON in a prefetch
const BALLS = '<picture><source type="image/avif" srcSet="/images/sports/cricket-128.avif 128w, /images/sports/cricket-256.avif 256w"/></picture>';
const html = (build = BUILD, pictures = BALLS) =>
  `<html>${pictures}<script>self.__next_f.push([1,"0:{\\"P\\":null,\\"b\\":\\"${build}\\",\\"c\\":[]}"])</script></html>`;
const IMAGE_URL = `${BASE}/images/sports/cricket-128.avif`;
const image = (cf: string) => ({ headers: { 'content-type': 'image/avif', 'cache-control': 'public, max-age=14400', 'cf-cache-status': cf } });
const icon = (cf: string) => ({ headers: { 'content-type': 'image/x-icon', 'cache-control': 'public, max-age=14400, must-revalidate', 'cf-cache-status': cf } });
const board = (cf: string) => ({
  headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', 'cf-cache-status': cf },
  body: '{"leaderboard":[]}',
});
const manifest = (cf: string, cacheControl = MANIFEST_CACHE_CONTROL) =>
  ({ headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': cacheControl, 'cf-cache-status': cf }, body: '{"name":"1Think2Win"}' });
const flight = (build = BUILD) => `0:{"staleTime":300,"buildId":"${build}"}`;
const page = (cf: string, build = BUILD, extra: Record<string, string> = {}) =>
  ({ headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': PAGE_CACHE_CONTROL, 'cf-cache-status': cf, ...extra }, body: html(build) });
const prefetch = (cf: string, build = BUILD) =>
  ({ headers: { 'content-type': 'text/x-component', 'cache-control': PAGE_CACHE_CONTROL, 'cf-cache-status': cf }, body: flight(build) });

// Production once the rule is on: each page MISS then HIT; everything else comes from the origin
const CACHED_SITE: Record<string, Route | Route[]> = {
  [`${BASE}${ORIGIN_PROBE}`]: page('DYNAMIC'),
  ...Object.fromEntries(CACHED_PAGES.map((p) => [`${BASE}${p}`, [page('MISS'), page('HIT')]])),
  [`${PREFETCH_URL} [rsc]`]: [prefetch('MISS'), prefetch('HIT')],
  [PREFETCH_URL]: page('DYNAMIC'),
  [`${BASE}/faq [cookie]`]: page('DYNAMIC'),
  [`${BASE}/quizzes`]: { status: 307, headers: { location: '/login?redirect=%2Fquizzes', 'cf-cache-status': 'DYNAMIC' } },
  [`${BASE}/login`]: { status: 307, headers: { location: '/auth?mode=login', 'cf-cache-status': 'DYNAMIC' } },
  [`${BASE}/auth`]: page('DYNAMIC'),
  [`${BASE}/api/health`]: { headers: { 'cache-control': 'no-store', 'cf-cache-status': 'DYNAMIC' }, body: '{"status":"ok"}' },
  [IMAGE_URL]: [image('MISS'), image('HIT')],
  [`${BASE}${FAVICON_PATH}`]: [icon('MISS'), icon('HIT')],
  [`${BASE}${LEADERBOARD_PATH}`]: [board('MISS'), board('HIT')],
  [`${BASE}${MANIFEST_PATH}`]: [manifest('MISS'), manifest('HIT')],
  // The rewrite drops the tracking parameters, so the landing gets the cached `/` (already a HIT)
  [`${BASE}${AD_LANDING}`]: page('HIT'),
  [`${BASE}${MIXED_LANDING}`]: page('DYNAMIC'),
};

// Production on 2026-10-21, before the rules: the same pages and files, every one DYNAMIC
const UNCACHED_SITE: Record<string, Route | Route[]> = {
  ...CACHED_SITE,
  ...Object.fromEntries(CACHED_PAGES.map((p) => [`${BASE}${p}`, page('DYNAMIC')])),
  [`${PREFETCH_URL} [rsc]`]: prefetch('DYNAMIC'),
  // Next sends public files with max-age=0: Cloudflare keeps them but asks Hostinger on every request
  [IMAGE_URL]: [image('MISS'), image('REVALIDATED')],
  [`${BASE}${FAVICON_PATH}`]: [icon('MISS'), icon('EXPIRED')],
  [`${BASE}${LEADERBOARD_PATH}`]: board('DYNAMIC'),
  [`${BASE}${MANIFEST_PATH}`]: manifest('DYNAMIC'),
  [`${BASE}${AD_LANDING}`]: page('DYNAMIC'),
};

/** A fake site keyed by URL, plus " [rsc]" / " [cookie]" when those headers are sent (a list answers in turn). */
function fakeSite(routes: Record<string, Route | Route[]>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const served = new Map<string, number>();
  let inFlight = 0;
  let maxInFlight = 0;
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await Promise.resolve();
    inFlight--;
    const headers = new Headers(init.headers);
    const key = `${url}${headers.has('rsc') ? ' [rsc]' : ''}${headers.has('cookie') ? ' [cookie]' : ''}`;
    const entry = routes[key];
    if (!entry) throw new Error(`unexpected request ${key}`);
    const n = served.get(key) ?? 0;
    served.set(key, n + 1);
    const route = Array.isArray(entry) ? entry[Math.min(n, entry.length - 1)] : entry;
    if (route instanceof Error) throw route;
    return new Response(route.body ?? null, { status: route.status ?? 200, headers: route.headers });
  };
  return { fetcher, calls, maxInFlight: () => maxInFlight };
}

async function run(overrides: Record<string, Route | Route[]> = {}, base = CACHED_SITE) {
  const site = fakeSite({ ...base, ...overrides });
  const results = await runPageCacheChecks(options, site.fetcher);
  return { ...site, results };
}

const byName = (results: CheckResult[], name: string) => {
  const result = results.find((r) => r.name === name);
  if (!result) throw new Error(`no check named ${name}`);
  return result;
};
const failures = (results: CheckResult[]) => results.filter((r) => r.outcome === 'fail').map((r) => r.name);
const probeOf = (route: { status?: number; headers?: Record<string, string>; body?: string }): Probe =>
  ({ status: route.status ?? 200, headers: new Headers(route.headers), body: route.body ?? '' });

describe('rscSearchParam', () => {
  it("matches the _rsc values Next's client sent from the home page", async () => {
    expect(await rscSearchParam(PREFETCH_HEADERS)).toBe('5CB68i4pnAekjehf');
    expect(await rscSearchParam({ ...PREFETCH_HEADERS, 'next-router-segment-prefetch': '/__PAGE__' })).toBe('8nTjltbQWvg6NcbE');
  });
});

describe('buildIdOf', () => {
  it('reads the build from page HTML and from a prefetch', () => {
    expect(buildIdOf(html())).toBe(BUILD);
    expect(buildIdOf(flight(OLD_BUILD))).toBe(OLD_BUILD);
    expect(buildIdOf('<html>Parked Domain name on Hostinger DNS system</html>')).toBeNull();
  });
});

describe('the Cache Rule in deploy/cloudflare-page-cache-rule.json', () => {
  const rule = JSON.parse(readFileSync(path.join(__dirname, '../../deploy/cloudflare-page-cache-rule.json'), 'utf8'));

  it('covers exactly the pages these checks expect to be cached', () => {
    const set = /http\.request\.uri\.path in \{([^}]*)\}/.exec(rule.expression)?.[1] ?? '';
    expect([...set.matchAll(/"([^"]*)"/g)].map((m) => m[1]).sort()).toEqual([...CACHED_PAGES].sort());
    for (const path of Object.keys(UNCACHED_PATHS)) expect(set).not.toContain(`"${path}"`);
  });

  it('leaves session cookies and stray RSC headers to the origin, and caches only what the origin allows', () => {
    expect(rule.expression).toContain('not http.cookie contains "-auth-token"');
    expect(rule.expression).toContain('http.request.uri.query eq "" and not any(lower(http.request.headers.names[*])[*] eq "rsc")');
    expect(rule.expression).toContain('len(http.request.headers["rsc"]) eq 1 and http.request.headers["rsc"][0] eq "1"');
    expect(rule.action_parameters).toEqual({ cache: true, edge_ttl: { mode: 'bypass_by_default' }, browser_ttl: { mode: 'respect_origin' } });
  });
});

describe('the rules for shared JSON and ad landings (deploy/cloudflare-*-rule.json)', () => {
  const read = (name: string) => JSON.parse(readFileSync(path.join(__dirname, '../../deploy', name), 'utf8'));
  const pageRule = read('cloudflare-page-cache-rule.json');

  it('caches the leaderboard API and the manifest for the time the origin allows, like the pages', () => {
    for (const [file, pathName] of [['cloudflare-leaderboard-cache-rule.json', LEADERBOARD_PATH], ['cloudflare-manifest-cache-rule.json', MANIFEST_PATH]]) {
      const rule = read(file);
      expect(rule.expression).toBe(`(http.host eq "1think2win.com" and http.request.uri.path eq "${pathName}")`);
      expect(rule.action_parameters).toEqual(pageRule.action_parameters);
    }
  });

  it("keeps public/ files at the edge whatever Next's max-age=0 says, browsers 4 h, and never stores an error", () => {
    const rule = read('cloudflare-static-files-cache-rule.json');
    expect(rule.expression).toContain('starts_with(http.request.uri.path, "/images/")');
    expect(rule.expression).toContain('starts_with(http.request.uri.path, "/Favicon/")');
    expect(rule.expression).toContain(`http.request.uri.path eq "${FAVICON_PATH}"`);
    // The service worker stays out, so a new one is never held back
    expect(rule.expression).not.toContain('sw.js');
    expect(rule.action_parameters).toEqual({
      cache: true,
      edge_ttl: { mode: 'override_origin', default: 2592000, status_code_ttl: [{ status_code_range: { from: 400 }, value: -1 }] },
      browser_ttl: { mode: 'override_origin', default: 14400 },
    });
  });

  it('drops a query string only on the cached pages, and only when every parameter is a tracking one', () => {
    const rule = read('cloudflare-tracking-query-rewrite-rule.json');
    const pages = /http\.request\.uri\.path in \{([^}]*)\}/.exec(rule.expression)?.[1] ?? '';
    expect([...pages.matchAll(/"([^"]*)"/g)].map((m) => m[1]).sort()).toEqual([...CACHED_PAGES].sort());
    const tracking = /all\(http\.request\.uri\.args\.names\[\*\] in \{([^}]*)\}\)/.exec(rule.expression)?.[1] ?? '';
    const names = [...tracking.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    for (const name of new URLSearchParams(AD_LANDING.slice(2)).keys()) expect(names).toContain(name);
    expect(names).not.toContain('ref');
    expect(names).not.toContain('_rsc');
    expect(names).not.toContain(ORIGIN_PROBE.slice(2).split('=')[0]);
    expect(rule.action_parameters).toEqual({ uri: { query: { value: '' } } });
  });
});

describe('runPageCacheChecks', () => {
  it('passes once the rule is on, one request at a time, and never sends a cookie except the fake session', async () => {
    const { results, calls, maxInFlight } = await run();
    expect(failures(results)).toEqual([]);
    expect(results.map((r) => `${r.outcome} ${r.status} ${r.name}`)).toEqual([
      `pass 200 GET ${ORIGIN_PROBE} (origin's build)`,
      ...CACHED_PAGES.map((p) => `pass 200 GET ${p} (twice)`),
      'pass 200 GET /faq?_rsc= (prefetch, twice)',
      'pass 200 GET /faq?_rsc= without the RSC header',
      'pass 200 GET /faq with a session cookie',
      'pass 307 GET /quizzes',
      'pass 307 GET /login',
      'pass 200 GET /auth',
      'pass 200 GET /api/health',
      'pass 200 GET / pictures are static files',
      'pass 200 GET /images/sports/cricket-128.avif (twice)',
      'pass 200 GET /favicon.ico (twice)',
      'pass 200 GET /api/leaderboard (twice)',
      'pass 200 GET /manifest.json (twice)',
      `pass 200 GET ${AD_LANDING} (ad landing, twice)`,
      `pass 200 GET ${MIXED_LANDING}`,
    ]);
    expect(byName(results, 'GET /faq (twice)').detail).toBe(`MISS then cf-cache-status=HIT, build=${BUILD}`);
    expect(byName(results, 'GET /images/sports/cricket-128.avif (twice)').detail).toBe('MISS then cf-cache-status=HIT');
    expect(calls).toHaveLength(38);
    expect(maxInFlight()).toBe(1);
    expect(calls.filter((c) => new Headers(c.init.headers).has('cookie')).map((c) => c.url)).toEqual([`${BASE}/faq`]);
  });

  it('fails every cached check while the rules are off (production before the change)', async () => {
    const { results } = await run({}, UNCACHED_SITE);
    expect(failures(results)).toEqual([
      ...CACHED_PAGES.map((p) => `GET ${p} (twice)`),
      'GET /faq?_rsc= (prefetch, twice)',
      'GET /images/sports/cricket-128.avif (twice)',
      'GET /favicon.ico (twice)',
      'GET /api/leaderboard (twice)',
      'GET /manifest.json (twice)',
      `GET ${AD_LANDING} (ad landing, twice)`,
    ]);
    expect(byName(results, 'GET / (twice)').problems).toEqual([
      'cf-cache-status is DYNAMIC, expected HIT/EXPIRED/REVALIDATED/UPDATING on a repeat request',
    ]);
  });

  it('asks for a purge when Cloudflare still serves the previous build', async () => {
    const { results } = await run({ [`${BASE}/faq`]: page('HIT', OLD_BUILD) });
    expect(failures(results)).toEqual(['GET /faq (twice)']);
    expect(byName(results, 'GET /faq (twice)').problems).toEqual([
      `build ${OLD_BUILD} is not the origin's ${BUILD}: purge the cache (bun run cache:purge)`,
    ]);
  });

  it("fails when Cloudflare hands browsers a max-age (the zone's 4 h Browser Cache TTL) or a cookie", async () => {
    const { results } = await run({
      [`${BASE}/terms`]: page('HIT', BUILD, { 'cache-control': 'max-age=14400, s-maxage=31536000' }),
      [`${BASE}/privacy`]: page('HIT', BUILD, { 'set-cookie': 'sb-x-auth-token=leak; Path=/' }),
    });
    expect(failures(results)).toEqual(['GET /terms (twice)', 'GET /privacy (twice)']);
    expect(byName(results, 'GET /terms (twice)').problems).toEqual([
      `Cache-Control is "max-age=14400, s-maxage=31536000", expected "${PAGE_CACHE_CONTROL}"`,
    ]);
    expect(byName(results, 'GET /privacy (twice)').problems).toEqual(['a cached response sets a cookie']);
  });

  it('catches a prefetch served to a page request, and cached pages for signed-in visitors or personal routes', async () => {
    const { results } = await run({
      [PREFETCH_URL]: prefetch('HIT'),
      [`${BASE}/faq [cookie]`]: page('HIT'),
      [`${BASE}/auth`]: page('MISS'),
    });
    expect(failures(results)).toEqual(['GET /faq?_rsc= without the RSC header', 'GET /faq with a session cookie', 'GET /auth']);
    expect(byName(results, 'GET /faq?_rsc= without the RSC header').problems).toEqual([
      'content-type is text/x-component, expected text/html',
      'cf-cache-status is HIT, expected DYNAMIC/BYPASS: the page cache must not answer this',
    ]);
  });

  it("catches home page pictures resized on Hostinger, an uncached ball picture, and a manifest browsers can't keep", async () => {
    const { results, calls } = await run({
      [`${BASE}/`]: [page('MISS'), { ...page('HIT'), body: html(BUILD, '<img src="/_next/image?url=%2Fimages%2Fsports%2Fcricket.webp&w=256&q=75">') }],
      // Production after the manifest rule, before the build that sends a day's max-age
      [`${BASE}${MANIFEST_PATH}`]: [manifest('MISS', 'public, max-age=0'), manifest('REVALIDATED', 'public, max-age=0')],
    });
    expect(failures(results)).toEqual(['GET / pictures are static files', 'GET /manifest.json (twice)']);
    expect(byName(results, 'GET / pictures are static files').problems).toEqual([
      'the home page loads pictures through /_next/image: Hostinger resizes each one, and Cloudflare never caches it',
      'no pre-sized ball picture (/images/sports/<ball>-<width>.avif) in the home page',
    ]);
    expect(byName(results, 'GET /manifest.json (twice)').problems).toEqual([
      `Cache-Control is "public, max-age=0", expected "${MANIFEST_CACHE_CONTROL}"`,
    ]);
    // With no static picture named there is nothing to fetch
    expect(calls.map((c) => c.url)).not.toContain(IMAGE_URL);

    const uncached = await run({ [IMAGE_URL]: image('DYNAMIC') });
    expect(failures(uncached.results)).toEqual(['GET /images/sports/cricket-128.avif (twice)']);
    // Kept, but rechecked with Hostinger each time: what the static files rule stops
    const rechecked = await run({ [IMAGE_URL]: [image('MISS'), image('REVALIDATED')] });
    expect(byName(rechecked.results, 'GET /images/sports/cricket-128.avif (twice)').problems).toEqual([
      'cf-cache-status is REVALIDATED, expected HIT: Cloudflare asked Hostinger again (deploy/cloudflare-static-files-cache-rule.json)',
    ]);
    const missing = await run({ [IMAGE_URL]: new Error('timeout') });
    expect(byName(missing.results, 'GET /images/sports/cricket-128.avif (twice)').problems).toEqual(['request failed: timeout']);
  });

  it('catches an ad landing served from an old build, and a rewrite that also drops non-tracking query strings', async () => {
    const { results } = await run({
      [`${BASE}${AD_LANDING}`]: page('HIT', OLD_BUILD),
      [`${BASE}${MIXED_LANDING}`]: page('HIT'),
    });
    expect(failures(results)).toEqual([`GET ${AD_LANDING} (ad landing, twice)`, `GET ${MIXED_LANDING}`]);
    expect(byName(results, `GET ${MIXED_LANDING}`).problems).toEqual([
      'cf-cache-status is HIT, expected DYNAMIC/BYPASS: the page cache must not answer this',
    ]);
  });

  it('reports a failed request as a failed check and carries on', async () => {
    const { results } = await run({ [`${BASE}${ORIGIN_PROBE}`]: new Error('timeout') });
    expect(byName(results, `GET ${ORIGIN_PROBE} (origin's build)`).problems).toEqual(['request failed: timeout']);
    expect(failures(results)).toEqual([`GET ${ORIGIN_PROBE} (origin's build)`]);
  });
});

describe('decidePurge', () => {
  const origin = probeOf(page('DYNAMIC'));

  it('purges when Cloudflare holds another build or no cached copy', () => {
    expect(decidePurge(origin, probeOf(page('HIT', OLD_BUILD)), false)).toEqual({
      purge: true, reason: `origin serves build ${BUILD}; Cloudflare had ${OLD_BUILD} (cf-cache-status=HIT)`,
    });
    expect(decidePurge(origin, probeOf(page('DYNAMIC')), false).purge).toBe(true);
  });

  it('waits while Cloudflare already serves the build the origin runs (deploy not live yet), unless forced', () => {
    const waiting = decidePurge(origin, probeOf(page('HIT')), false);
    expect(waiting.purge).toBe(false);
    expect(waiting.reason).toMatch(/^Cloudflare already serves build OsLjE9ZrZ4Da05OFkff1u, the one the origin runs\. If you just deployed/);
    expect(decidePurge(origin, probeOf(page('HIT')), true).purge).toBe(true);
  });

  it('does not purge when the origin is not the app', () => {
    expect(decidePurge(new Error('timeout'), probeOf(page('HIT')), false)).toEqual({ purge: false, reason: "could not read the origin's build: timeout" });
    expect(decidePurge(probeOf({ status: 403, body: '403 Forbidden' }), probeOf(page('HIT')), false)).toEqual({
      purge: false, reason: 'the origin answered 403 without a build ID (not the app?)',
    });
  });
});

describe('purgeEverything', () => {
  const credentials = { zoneId: 'zone123', apiToken: 'secret-token' };

  it('posts purge_everything to the zone with the token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await purgeEverything(credentials, async (url, init) => {
      calls.push({ url, init });
      return new Response('{"success":true,"errors":[],"result":{"id":"zone123"}}');
    });
    expect(calls.map((c) => [c.url, c.init.method, new Headers(c.init.headers).get('authorization'), c.init.body])).toEqual([
      ['https://api.cloudflare.com/client/v4/zones/zone123/purge_cache', 'POST', 'Bearer secret-token', '{"purge_everything":true}'],
    ]);
  });

  it("throws Cloudflare's errors, never the token", async () => {
    const failing = purgeEverything(credentials, async () =>
      new Response('{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}', { status: 403 }));
    await expect(failing).rejects.toThrow('Cloudflare purge failed (HTTP 403): 10000 Authentication error');
    await expect(failing).rejects.not.toThrow(/secret-token/);
  });
});

describe('parsePageCacheArgs and cloudflareCredentials', () => {
  it('checks production by default and purges only when asked', () => {
    expect(parsePageCacheArgs([], {})).toMatchObject({ baseUrl: BASE, purge: false, force: false });
    expect(parsePageCacheArgs(['--purge', '--force', '--base', 'https://staging.example.com'], {}))
      .toMatchObject({ baseUrl: 'https://staging.example.com', purge: true, force: true });
    expect(() => parsePageCacheArgs(['--force'], {})).toThrow('--force only goes with --purge');
    expect(() => parsePageCacheArgs(['--nope'], {})).toThrow('Unknown option --nope');
  });

  it('names the missing purge credentials', () => {
    expect(cloudflareCredentials({ CLOUDFLARE_ZONE_ID: ' z ', CLOUDFLARE_API_TOKEN: 't' })).toEqual({ zoneId: 'z', apiToken: 't' });
    expect(() => cloudflareCredentials({ CLOUDFLARE_ZONE_ID: 'z' })).toThrow('--purge needs CLOUDFLARE_API_TOKEN: put them in .env.cloudflare');
    expect(() => cloudflareCredentials({})).toThrow('--purge needs CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN');
  });
});
