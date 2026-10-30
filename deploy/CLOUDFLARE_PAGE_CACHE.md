# Cloudflare page cache for the public pages

**Status: live since 2026-10-21 18:29 UTC (owner-approved). Every Hostinger deploy now needs `bun run cache:purge`
(see "Every deploy" below).** Right after it was applied, `bun run cache:check` passed 17/17 and
`bun run smoke:prod` passed 10/10.

## Why

Hostinger Business hosting blocks the whole site (HTTP 403, about 19 minutes) once roughly 100 requests per
second reach it, and that limit can't be configured. Cloudflare marks the public pages' HTML `DYNAMIC`, so every
page view reaches Hostinger. Next's link prefetches also reach Hostinger, and they are the bigger share. One
anonymous visit to `/` on a desktop browser (2026-10-21) sent **15 requests to Hostinger**: the HTML, 13
`?_rsc=` prefetches and one redirect. Seven such visits a second are enough to trip the block. Static files
(`/_next/static/*`) are already Cloudflare HITs.

This rule serves the public pages and their prefetches from Cloudflare's cache to visitors who are not signed
in. That same visit then sends **6** requests to Hostinger: the prefetches of `/quizzes`, `/login` and
`/register`, which stay uncached. See "What still reaches Hostinger" below.

## Which pages are cached

All nine are client components that are prerendered at build time. Personal data (the signed-in user, prizes,
the leaderboard) loads in the browser after the page arrives, so the HTML is the same for every visitor.
Checked on production (build of `0f046f3`) and on `main` (`aa69ba8`), where these pages and the root layout are
unchanged. On 2026-10-21 each page sent this to an anonymous visitor:

| Path | `x-nextjs-prerender` | `Cache-Control` | `Set-Cookie` | Personal data |
|---|---|---|---|---|
| `/` | 1 | `s-maxage=31536000` | none | none in HTML |
| `/faq`, `/how-to-play`, `/terms`, `/privacy`, `/disclaimer`, `/contact` | 1 | `s-maxage=31536000` | none | none |
| `/prizes` | 1 | `s-maxage=31536000` | none | loaded by a server-action POST (never cached) |
| `/leaderboard` | 1 | `s-maxage=31536000` | none | loaded from `/api/leaderboard` (not covered) |

Two anonymous fetches of `/` differ only in Cloudflare's email obfuscation, which Cloudflare applies at the edge
after the cache.

**Never cached by this rule:** `/quizzes`, `/quiz/*`, `/profile*`, `/login` (a redirect to `/auth`), `/register`,
`/auth*`, `/forgot-*`, `/update-password`, `/unsubscribe`, `/admin*` and `/api/*`. They are simply not in the
path list. The existing `/api/live` rule is unchanged.

## The rule

The exact API body is in [`cloudflare-page-cache-rule.json`](./cloudflare-page-cache-rule.json). A unit test keeps
its path list equal to the list that `bun run cache:check` verifies.

| Setting | Value |
|---|---|
| Expression | see below |
| Cache eligibility | Eligible for cache |
| Edge TTL | **Use cache-control header if present, bypass cache if not** (`bypass_by_default`) |
| Browser TTL | **Respect origin TTL** (`respect_origin`) |
| Cache key | default (the full URL, query string included) |

```
(http.host eq "1think2win.com"
 and http.request.uri.path in {"/" "/faq" "/how-to-play" "/prizes" "/leaderboard" "/terms" "/privacy" "/disclaimer" "/contact"}
 and not http.cookie contains "-auth-token"
 and (
   (http.request.uri.query eq "" and not any(lower(http.request.headers.names[*])[*] eq "rsc"))
   or
   (starts_with(http.request.uri.query, "_rsc=") and len(http.request.uri.query) eq 21
    and len(http.request.headers["rsc"]) eq 1 and http.request.headers["rsc"][0] eq "1")
 ))
```

What each part is for:

- **`not http.cookie contains "-auth-token"`: signed-in visitors always reach Hostinger.** On a public page,
  `src/lib/supabase/middleware.ts` refreshes or clears an expiring Supabase session. The response then carries
  `Set-Cookie` *and* `s-maxage=31536000` (seen on production with an expired test cookie), so a cached copy could
  hand one visitor's session to the next. This condition keeps those requests out of the cache. As a second guard,
  Cloudflare never stores a response with `Set-Cookie` unless an Edge TTL overrides the origin, and this rule
  doesn't. Signed-in visitors also keep the current session-refresh behaviour.
- **Two shapes of request, each with its own cache key.** Without the RSC header and without a query string,
  the request gets the HTML. With exactly one `RSC: 1` header and `?_rsc=<16 characters>`, it gets Next's prefetch
  payload (`text/x-component`). Next makes `_rsc` a SHA-256 of the headers it varies on, and answers a mismatch with
  a 307. So each URL maps to one response, even though Cloudflare ignores `Vary`. The pairing matters: production
  answers `/prizes?_rsc=<hash>` *without* the RSC header with HTML and `s-maxage=31536000`, which a looser rule
  would store under the key real prefetches use. Next accepts only the literal `1` (a repeated header gets HTML),
  so the rule requires exactly one value.
- **Any other query string reaches Hostinger** (`?fbclid=`, `utm_*`). Ignoring the query in the cache key is
  Enterprise-only. The prefetches that follow such a landing still hit the cache, because `Next-Url` is the
  pathname without its query.
- **Edge TTL `bypass_by_default`** caches only responses that carry a `Cache-Control` header, so a Hostinger error or
  bot page without one is never stored. A response marked `private`/`no-store` is never stored either: Hostinger's
  403 block page, or a page that later becomes dynamic in Next. The TTL is Next's `s-maxage`: one year, until purged.
- **Browser TTL `respect_origin`**: browsers get `s-maxage=31536000` with no `max-age`, so they come back to
  Cloudflare on every visit and see a new deploy at once. The zone's default Browser Cache TTL is 4 h, and
  `cache:check` fails if Cloudflare ever adds a `max-age`.
- **Apex host only**: `www` answers with a 301 to the apex.

Plan limits: this made 2 of the 10 Cache Rules on the Free plan. With the rules below, the zone uses 5 of 10
Cache Rules and 1 of 10 URL Rewrite Rules. No Cache Response Rules or custom cache keys are needed.

## Static files, shared JSON and ad landings (live since 2026-10-29)

Four more rules, applied through the Cloudflare API on 2026-10-29. The exact bodies are in `deploy/`, and unit
tests keep them in step with what `cache:check` verifies.

| Rule | File | What it does |
|---|---|---|
| Cache Rule *Static files* | [`cloudflare-static-files-cache-rule.json`](./cloudflare-static-files-cache-rule.json) | Keeps `/images/*`, `/Favicon/*` and `/favicon.ico` at the edge for 30 days (we purge on every deploy), and in browsers for 4 h. Next serves `public/` files with `max-age=0`, so before this rule Cloudflare kept them but asked Hostinger on every request (`REVALIDATED`): 7–8 Hostinger requests per new visitor to `/`. A 4xx/5xx is never stored. `sw.js` is left out so a new service worker is never held back. |
| Cache Rule *Leaderboard API* | [`cloudflare-leaderboard-cache-rule.json`](./cloudflare-leaderboard-cache-rule.json) | Caches `/api/leaderboard` for its own `s-maxage=60`. The route reads no cookie or session, so every visitor gets the same answer for the same query. |
| Cache Rule *Web app manifest* | [`cloudflare-manifest-cache-rule.json`](./cloudflare-manifest-cache-rule.json) | Caches `/manifest.json` for its own `max-age` (one day, set in `next.config.js`). |
| URL Rewrite *Drop tracking query* | [`cloudflare-tracking-query-rewrite-rule.json`](./cloudflare-tracking-query-rewrite-rule.json) | On the nine cached pages, drops a query string made **only** of tracking parameters (`utm_*`, `fbclid`, `gclid`, `ttclid`, `igsh`, …). The page cache rule then sees an empty query, so ad and social landings get the cached page. |

Notes:

- **The leaderboard and manifest rules use the same settings as the page rule** (`bypass_by_default`,
  `respect_origin`), so an error without a `Cache-Control` header is never stored. The static files rule overrides
  the origin's TTL instead, because Next's `max-age=0` is what it exists to replace.
- **The rewrite keeps the whole query string when any parameter is not a tracking one.** `/?ref=x&utm_source=y`
  still reaches Hostinger, and so do `/?page-cache-check=1` (the origin probe) and every `?_rsc=` prefetch.
- **Analytics are unaffected.** The rewrite only changes the URL Hostinger sees. The browser keeps the full URL,
  so Cloudflare Web Analytics, which runs in the browser, still records the tracking parameters. The app itself
  never reads them.
- **Rollback** is the same as for the page rule: switch the rule off. For the rewrite, use **Rules → Transform
  Rules → URL Rewrite**.

## Apply (owner)

1. Create the purge token first (see "Every deploy" below), so the first purge works.
2. Cloudflare dashboard → 1think2win.com → **Caching → Cache Rules → Create rule**. Name: *Public pages for
   visitors without a session*. **Edit expression**, paste the expression above. Cache eligibility **Eligible for
   cache**. Edge TTL **Use cache-control header if present, bypass cache if not**. Browser TTL **Respect origin
   TTL**. Deploy.
   - Or by API: `POST /zones/<zone id>/rulesets/<cache-settings entrypoint id>/rules` with the JSON file as the body.
     Claude can do this with the Cloudflare connector once you say so.
3. Check right away, one request at a time:
   ```bash
   bun run cache:check
   bun run smoke:prod
   ```
   Spot checks (the second request should say `HIT`):
   ```bash
   curl -sS -o /dev/null -D - https://1think2win.com/faq | grep -iE "cf-cache-status|cache-control|set-cookie"
   ```
   `/quizzes` and `/api/health` must stay `DYNAMIC`.

## Rollback

Takes effect at once and needs no purge: **Caching → Cache Rules → switch the rule off** (or delete it). The
requests become `DYNAMIC` again and stored copies are no longer used. API: `DELETE` the rule by its ID.
The IDs and the state before the change are in the git-ignored `load-test/.data/cloudflare-page-cache-rollback.json`.

If you turn the rule back on after a deploy happened while it was off, run `bun run cache:purge -- --force` first.
The stored copies would be the old build.

## Every deploy: purge, then smoke

With the rule on, a deploy isn't visible until the cache is purged. Until then visitors get the old pages, which
point at JS chunks the new build deleted.

1. Upload and deploy in hPanel as usual, and wait until the deployment shows as finished.
2. `bun run cache:purge`: it reads the build ID the origin serves (through `/?page-cache-check=1`, which the
   cache never answers) and the one Cloudflare serves for `/`. If they already match on a cached copy, the
   deploy isn't live yet: it stops without purging. Otherwise it runs **Purge Everything** and then the full
   `cache:check`. Purge Everything is simplest because prefetch URLs can't be listed (their `_rsc` values depend on
   the page that sent them). With Smart Tiered Cache on, the refill costs about one origin fetch per URL.
3. `bun run smoke:prod`.

Without the token: **Caching → Configuration → Purge Everything**, then `bun run cache:check`.

**Token setup (once):** Cloudflare → My Profile → API Tokens → Create Token → Custom token. Permissions:
**Zone · Cache Purge · Purge**. Zone resources: **Include · Specific zone · 1think2win.com**. Nothing else. Put it
in a file named `.env.cloudflare` in the project folder (git-ignored). Never put it in `.env`:
`scripts/build-hostinger.ps1` copies `.env` into the Hostinger variables.

```
CLOUDFLARE_ZONE_ID=<the Zone ID from the zone's Overview page>
CLOUDFLARE_API_TOKEN=<the token>
```

Don't deploy during a live quiz. The purge makes each page fetch from Hostinger once more.

## What still reaches Hostinger

From one desktop visit to `/` (prefetches only fire for links on screen, so mobile sends fewer):

| Request | Count | Why it stays |
|---|---|---|
| `/quizzes?_rsc=` (307) and the `/login?redirect=…` it leads to | 2 | personal route |
| `/login?_rsc=`, `/register?_rsc=` | 4 | personal routes, left out on purpose |
| `/prizes` server-action POST (on `/prizes`) | 1 | POST, never cached |
| a landing with a non-tracking query string (`/?ref=…`) | 1 | the rewrite only drops tracking-only query strings |
| anything from a signed-in visitor | all | session cookie; the navbar's prefetches included |

Done since: `prefetch={false}` on links to personal routes (a65f215) removes the 6 prefetches above for current
builds. The home page's sport balls are static files instead of `/_next/image` (PR #82). Static files,
`/api/leaderboard`, `/manifest.json` and tracking-only landings are covered by the rules in "Static files, shared
JSON and ad landings".
