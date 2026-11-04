/**
 * Verifies Supabase access tokens at the edge. The project signs them with ES256 (ECDSA P-256 / SHA-256) and
 * publishes the public keys at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, so no secret is needed here.
 */
import { base64UrlToBytes } from './http';

/** How long a fetched key set is used before it is fetched again */
export const JWKS_TTL_MS = 10 * 60_000;
/** With keys in hand, at most one refetch per isolate in this window (an unknown kid, or a failed refresh) */
export const JWKS_REFETCH_GAP_MS = 10_000;
const JWKS_TIMEOUT_MS = 5_000;
// Supabase gives signed-in users this audience; the service and anon keys have other roles
const AUDIENCE = 'authenticated';

export type TokenCheck = { ok: true; sub: string } | { ok: false; code: 'unauthorized' | 'session_expired' };

/** The key set could not be fetched and none is cached: the caller answers busy, as it is our fault, not the player's. */
export class JwksUnavailableError extends Error {}

type KeySet = { url: string; keys: Map<string, CryptoKey>; fetchedAt: number };
let keySet: KeySet | undefined;
let lastAttempt = 0;

/** Test hook: forget the cached key set. */
export function resetJwksCache(): void {
	keySet = undefined;
	lastAttempt = 0;
}

export function authBase(supabaseUrl: string): string {
	return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

async function fetchKeys(url: string): Promise<Map<string, CryptoKey>> {
	const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
	if (!response.ok) throw new Error(`JWKS answered ${response.status}`);
	const body = (await response.json()) as { keys?: Array<Record<string, unknown>> };
	const keys = new Map<string, CryptoKey>();
	for (const jwk of body.keys ?? []) {
		const { kty, crv, x, y, kid } = jwk;
		if (kty !== 'EC' || crv !== 'P-256' || typeof kid !== 'string' || typeof x !== 'string' || typeof y !== 'string') continue;
		try {
			keys.set(kid, await crypto.subtle.importKey('jwk', { kty, crv, x, y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
		} catch {
			console.error(JSON.stringify({ jwksBadKey: kid }));
		}
	}
	return keys;
}

/**
 * The verifying key for `kid`. Keys live in module memory for JWKS_TTL_MS. An unknown kid (a rotated key) or an
 * expired set triggers a refetch, at most once per JWKS_REFETCH_GAP_MS while keys are cached; a failed refresh keeps
 * the cached set. Requests are not made to share one in-flight fetch: Workers can't safely await another request's I/O.
 */
async function keyFor(url: string, kid: string): Promise<CryptoKey | undefined> {
	const now = Date.now();
	const current = keySet?.url === url ? keySet : undefined;
	const key = current?.keys.get(kid);
	if (key && now - current!.fetchedAt < JWKS_TTL_MS) return key;
	if (current && now - lastAttempt < JWKS_REFETCH_GAP_MS) return key;
	lastAttempt = now;
	try {
		keySet = { url, keys: await fetchKeys(url), fetchedAt: Date.now() };
	} catch (error) {
		console.error(JSON.stringify({ jwksFetchFailed: String(error) }));
		if (!current) throw new JwksUnavailableError(String(error));
		return key;
	}
	return keySet.keys.get(kid);
}

function decodeJson(part: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
		return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Checks a Supabase access token: ES256 signature by a published key (matched by `kid`), then `iss`, `aud`, `sub`
 * and `exp`. An expired but otherwise valid token is `session_expired`, so the client refreshes and sends again.
 * Throws JwksUnavailableError when no key set can be had.
 */
export async function verifyAccessToken(token: string, supabaseUrl: string): Promise<TokenCheck> {
	const unauthorized: TokenCheck = { ok: false, code: 'unauthorized' };
	const parts = token.split('.');
	if (parts.length !== 3) return unauthorized;
	const [headerPart, payloadPart, signaturePart] = parts;
	const header = decodeJson(headerPart);
	const payload = decodeJson(payloadPart);
	if (!header || !payload || header.alg !== 'ES256' || typeof header.kid !== 'string') return unauthorized;

	let signature: Uint8Array;
	try {
		signature = base64UrlToBytes(signaturePart);
	} catch {
		return unauthorized;
	}
	if (signature.byteLength !== 64) return unauthorized; // raw r || s, as JWS and WebCrypto both use

	const issuer = authBase(supabaseUrl);
	const key = await keyFor(`${issuer}/.well-known/jwks.json`, header.kid);
	if (!key) return unauthorized;
	const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
	if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signed))) return unauthorized;

	const { iss, aud, sub, exp } = payload;
	if (iss !== issuer) return unauthorized;
	if (!(aud === AUDIENCE || (Array.isArray(aud) && aud.includes(AUDIENCE)))) return unauthorized;
	if (typeof sub !== 'string' || sub.length === 0) return unauthorized;
	if (typeof exp !== 'number' || !Number.isFinite(exp)) return unauthorized;
	if (exp * 1000 <= Date.now()) return { ok: false, code: 'session_expired' };
	return { ok: true, sub };
}
