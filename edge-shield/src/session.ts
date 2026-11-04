/**
 * The Supabase session cookie, as @supabase/ssr 0.10 writes it: `sb-<ref>-auth-token`, split into `.0`, `.1`…
 * chunks when long, its value `base64-` plus base64url JSON (or plain JSON from older versions). The JSON holds
 * `access_token`, the JWT checked in jwt.ts.
 */
import { base64UrlToBytes } from './http';
import { type TokenCheck, verifyAccessToken } from './jwt';

const BASE64_PREFIX = 'base64-';

/** Cookie values as the `cookie` package (used by @supabase/ssr) reads them: unquoted and URI-decoded. */
function parseCookies(header: string): Map<string, string> {
	const jar = new Map<string, string>();
	for (const part of header.split(';')) {
		const eq = part.indexOf('=');
		if (eq < 0) continue;
		const name = part.slice(0, eq).trim();
		if (!name || jar.has(name)) continue;
		let value = part.slice(eq + 1).trim();
		if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
		if (value.includes('%')) {
			try {
				value = decodeURIComponent(value);
			} catch {
				// kept as sent, like the cookie package does
			}
		}
		jar.set(name, value);
	}
	return jar;
}

/** The whole cookie: the unsplit one, else its chunks `.0`, `.1`… joined in order (as combineChunks does). */
function combinedCookie(jar: Map<string, string>, name: string): string | undefined {
	const whole = jar.get(name);
	if (whole) return whole;
	let joined = '';
	for (let i = 0; ; i++) {
		const chunk = jar.get(`${name}.${i}`);
		if (!chunk) break;
		joined += chunk;
	}
	return joined || undefined;
}

export function sessionCookieName(supabaseUrl: string): string {
	return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/** The access token in the session cookie, or undefined when there is none or it can't be read. */
export function accessTokenFrom(cookieHeader: string | null, supabaseUrl: string): string | undefined {
	if (!cookieHeader) return undefined;
	let value = combinedCookie(parseCookies(cookieHeader), sessionCookieName(supabaseUrl));
	if (!value) return undefined;
	try {
		if (value.startsWith(BASE64_PREFIX)) value = new TextDecoder().decode(base64UrlToBytes(value.slice(BASE64_PREFIX.length)));
		const session: unknown = JSON.parse(value);
		const token = (session as { access_token?: unknown } | null)?.access_token;
		return typeof token === 'string' && token.length > 0 ? token : undefined;
	} catch {
		return undefined;
	}
}

/** The signed-in user's id from the verified session cookie. Throws JwksUnavailableError (see jwt.ts). */
export async function checkSession(request: Request, supabaseUrl: string): Promise<TokenCheck> {
	const token = accessTokenFrom(request.headers.get('Cookie'), supabaseUrl);
	if (!token) return { ok: false, code: 'unauthorized' };
	return verifyAccessToken(token, supabaseUrl);
}

// Key by session so users behind one carrier NAT don't share a bucket.
// The cookie is not verified here; the origin still authenticates every request.
export async function sessionKey(request: Request, ip: string): Promise<string> {
	const match = /sb-[^=]+-auth-token(?:\.0)?=([^;]+)/.exec(request.headers.get('Cookie') ?? '');
	if (!match) return `ip:${ip}`;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1]));
	return 's:' + [...new Uint8Array(digest, 0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
