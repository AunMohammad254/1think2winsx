import { createExecutionContext } from 'cloudflare:test';
import { env as bindings } from 'cloudflare:workers';
import { vi } from 'vitest';
import worker from '../src/index';
import type { LockinMessage } from '../src/lockin';

export const SITE = 'https://1think2win.com';
export const SUPABASE_URL = 'https://eclivawqhdovsndlngfo.supabase.co';
export const ISSUER = `${SUPABASE_URL}/auth/v1`;
export const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
export const COOKIE = 'sb-eclivawqhdovsndlngfo-auth-token';
export const USER = '5b0c7f9e-6a43-4d2b-9e1f-0c8a7d6b5e4f';
export const KID = 'test-key-1';
export const IP = '203.0.113.7';

const encoder = new TextEncoder();

export function b64url(data: string | ArrayBuffer | Uint8Array): string {
	const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function newKeyPair(): Promise<CryptoKeyPair> {
	return (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
}

export async function publicJwk(pair: CryptoKeyPair, kid = KID): Promise<Record<string, unknown>> {
	const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
	return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid, alg: 'ES256', use: 'sig', key_ops: ['verify'], ext: true };
}

/** A Supabase-style ES256 access token signed with `pair`. */
export async function signToken(
	pair: CryptoKeyPair,
	claims: Record<string, unknown> = {},
	header: Record<string, unknown> = {},
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const head = b64url(JSON.stringify({ alg: 'ES256', kid: KID, typ: 'JWT', ...header }));
	const body = b64url(
		JSON.stringify({ iss: ISSUER, aud: 'authenticated', sub: USER, role: 'authenticated', iat: now, exp: now + 3600, ...claims }),
	);
	const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, encoder.encode(`${head}.${body}`));
	return `${head}.${body}.${b64url(signature)}`;
}

/** The session cookie as @supabase/ssr writes it: `base64-` + base64url JSON, split into `chunks` cookies. */
export function sessionCookie(accessToken: string, { chunks = 1, encoding = 'base64url' as 'base64url' | 'raw' } = {}): string {
	const session = JSON.stringify({
		access_token: accessToken,
		token_type: 'bearer',
		expires_in: 3600,
		refresh_token: 'refresh-token',
		user: { id: USER, email: 'player@example.com', app_metadata: { provider: 'email' } },
	});
	const value = encoding === 'base64url' ? `base64-${b64url(session)}` : encodeURIComponent(session);
	if (chunks === 1) return `${COOKIE}=${value}`;
	const size = Math.ceil(value.length / chunks);
	return Array.from({ length: chunks }, (_, i) => `${COOKIE}.${i}=${value.slice(i * size, (i + 1) * size)}`).join('; ');
}

export type Limits = { submit?: boolean; api?: boolean; ip?: boolean; origin?: boolean };

/** An Env with stubbed limiters and queue; the tally is the real Durable Object binding from wrangler.toml. */
export function makeEnv({
	lockinEdge = 'true',
	enforce = 'true',
	limits = {} as Limits,
	send,
}: {
	lockinEdge?: string;
	enforce?: string;
	limits?: Limits;
	send?: (message: unknown, options?: QueueSendOptions) => Promise<QueueSendResponse>;
} = {}) {
	const limiter = (allow = true) => ({ limit: vi.fn(async (_options: RateLimitOptions) => ({ success: allow })) });
	const submit = limiter(limits.submit);
	const api = limiter(limits.api);
	const perIp = limiter(limits.ip);
	const budget = limiter(limits.origin);
	const queueSend = vi.fn(send ?? (async () => ({ metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } })));
	const queue = { send: queueSend, sendBatch: vi.fn(), metrics: vi.fn() } as unknown as Queue;
	const env: Env = {
		LOCKIN_QUEUE: queue,
		LOCKIN_TALLY: bindings.LOCKIN_TALLY,
		SUBMIT_LIMITER: submit,
		API_LIMITER: api,
		IP_LIMITER: perIp,
		ORIGIN_LIMITER: budget,
		SITE_URL: SITE,
		ENFORCE: enforce,
		LOCKIN_EDGE: lockinEdge,
		SUPABASE_URL,
		CRON_SECRET: 'test-secret',
		SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
	};
	return { env, queueSend, limiters: { submit: submit.limit, api: api.limit, perIp: perIp.limit, budget: budget.limit } };
}

export const call = (request: Request, env: Env, ctx = createExecutionContext()) =>
	worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, env, ctx);

export function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/**
 * Stubs fetch: the JWKS URL answers `jwks()` (a function, so a test can change it), everything else is "the origin".
 * Returns the spy and the origin calls only.
 */
export function stubFetch(
	jwks: () => Promise<Response> | Response,
	origin: (input: RequestInfo | URL) => Promise<Response> | Response = () => new Response('origin'),
) {
	const originCalls: string[] = [];
	const jwksCalls: string[] = [];
	const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = urlOf(input as RequestInfo | URL);
		if (url === JWKS_URL) {
			jwksCalls.push(url);
			return jwks();
		}
		originCalls.push(url);
		return origin(input as RequestInfo | URL);
	});
	return { spy, originCalls, jwksCalls };
}

export function lockinRequest(
	quizId: string,
	{
		cookie,
		origin = SITE,
		body = { answers: [{ questionId: 'question-1', selectedOption: 2 }] },
		headers = {} as Record<string, string>,
	}: {
		cookie?: string;
		origin?: string | null;
		body?: unknown;
		headers?: Record<string, string>;
	} = {},
): Request {
	const all = new Headers({ 'CF-Connecting-IP': IP, 'Content-Type': 'application/json', ...headers });
	if (origin !== null) all.set('Origin', origin);
	if (cookie) all.set('Cookie', cookie);
	return new Request(`${SITE}/api/quizzes/${quizId}/submit`, {
		method: 'POST',
		headers: all,
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
}

export function sentMessages(queueSend: ReturnType<typeof makeEnv>['queueSend']): LockinMessage[] {
	return queueSend.mock.calls.map(([message]) => message as LockinMessage);
}
