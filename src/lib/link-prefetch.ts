/**
 * When a `<Link>` may prefetch. Next prefetches every link in view (and again on hover) with `?_rsc=`
 * requests to the origin, and Hostinger blocks the whole site for ~19 minutes once roughly 100 requests a
 * second reach it. Cloudflare can answer only the public pages' prefetches, and only for visitors without a
 * session cookie (deploy/CLOUDFLARE_PAGE_CACHE.md). Every other prefetch is one more request to Hostinger.
 */

// Personal pages (rendered per user) and redirects: /login and /register always redirect, and /quizzes,
// /quiz/* and /profile* redirect visitors without a session to /login. No cache can answer their prefetch.
const UNCACHEABLE_ROUTE = /^\/(?:quizzes|quiz|profile|login|register|auth)(?=[/?#]|$)/;

export function isUncacheableRoute(href: string): boolean {
  return UNCACHEABLE_ROUTE.test(href);
}

/**
 * The `prefetch` prop for a `<Link>` to `href`. False (no prefetch, not even on hover) for uncacheable
 * routes, and for every route when `mayBeSignedIn`: a session cookie makes Cloudflare pass the request to
 * Hostinger. Otherwise undefined, Next's default. The link navigates either way.
 */
export function linkPrefetch(href: string, mayBeSignedIn = false): false | undefined {
  return mayBeSignedIn || isUncacheableRoute(href) ? false : undefined;
}
