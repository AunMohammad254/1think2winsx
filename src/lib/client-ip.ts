/**
 * Resolve the caller's IP for rate limiting and abuse monitoring.
 *
 * Why this is not trivial: every proxy between the visitor and this app adds the address it saw
 * to the `X-Forwarded-For` header ("client, proxy1, proxy2, ..."), but the visitor can also send
 * that header themselves. So the LEFTMOST entry is whatever the visitor chose to claim, and a
 * limiter keyed on it can be dodged (and its memory flooded) by rotating a fake value.
 *
 * Two ways to tell the app which value to believe (verify first: see .env.example and
 * load-test/README.md — GET /api/health?stats=1 shows what your host actually sends):
 *
 *  1. TRUSTED_IP_HEADER=<header name>
 *     Use when your host's proxy sets ONE header to the visitor's real IP and overwrites any value
 *     the visitor sent (e.g. cf-connecting-ip on Cloudflare, x-real-ip on some nginx setups).
 *
 *  2. TRUSTED_PROXY_HOPS=<n>
 *     Use when the host appends to X-Forwarded-For. n = how many proxies YOU control in front of the
 *     app (1 = one reverse proxy, 2 = CDN + proxy). We take the entry that the outermost trusted
 *     proxy appended, counting from the right — the first one a visitor cannot forge.
 *
 * When neither is set the previous behaviour (leftmost entry) is kept, so existing deployments don't
 * suddenly put every visitor into one shared limiter bucket if their proxy chain is deeper than assumed.
 */

const MAX_IP_LENGTH = 64; // bounds limiter key size so forged values can't bloat the store

function trustedHops(): number {
  const n = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function trustedHeaderName(): string | null {
  const name = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  return name ? name : null;
}

export function getClientIp(headers: { get(name: string): string | null }): string {
  // 1. A header the host's proxy owns outright
  const trustedHeader = trustedHeaderName();
  if (trustedHeader) {
    const value = headers.get(trustedHeader)?.split(',')[0]?.trim();
    if (value) return value.slice(0, MAX_IP_LENGTH);
  }

  // 2. X-Forwarded-For, counted from the right when hops are configured
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      const hops = trustedHops();
      const index = hops > 0 ? Math.max(0, parts.length - hops) : 0;
      return parts[index].slice(0, MAX_IP_LENGTH);
    }
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, MAX_IP_LENGTH);
  return 'unknown';
}

/** Headers worth showing in the diagnostic: the ones hosts commonly use to pass the visitor's IP. */
const IP_HEADER_CANDIDATES = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'x-client-ip',
  'forwarded',
] as const;

/**
 * What this server actually received, and what it would use. Backs `GET /api/health?stats=1`
 * (secret-protected) so you can determine the right TRUSTED_* setting with a single curl.
 */
export function describeClientIpHeaders(headers: { get(name: string): string | null }) {
  const received: Record<string, string | null> = {};
  for (const name of IP_HEADER_CANDIDATES) received[name] = headers.get(name);
  return {
    received,
    resolvedIp: getClientIp(headers),
    settings: {
      TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS ?? null,
      TRUSTED_IP_HEADER: process.env.TRUSTED_IP_HEADER ?? null,
    },
  };
}
