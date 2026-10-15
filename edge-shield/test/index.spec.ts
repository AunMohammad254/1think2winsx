import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

// A correctly typed incoming `Request` to pass to `worker.fetch()`
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ORIGIN = 'https://1think2win.com';
const IP = '203.0.113.7';

function makeEnv(allow = true, allowIp = allow) {
	const submit = vi.fn(async (_options: RateLimitOptions) => ({ success: allow }));
	const api = vi.fn(async (_options: RateLimitOptions) => ({ success: allow }));
	const perIp = vi.fn(async (_options: RateLimitOptions) => ({ success: allowIp }));
	const env: Env = {
		SUBMIT_LIMITER: { limit: submit },
		API_LIMITER: { limit: api },
		IP_LIMITER: { limit: perIp },
		SITE_URL: ORIGIN,
		CRON_SECRET: 'test-secret',
	};
	return { env, submit, api, perIp };
}

function mockOrigin(impl: () => Promise<Response> = async () => new Response('origin')) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
}

function apiRequest(path: string, init: { method?: string; cookie?: string } = {}) {
	const headers = new Headers({ 'CF-Connecting-IP': IP });
	if (init.cookie) headers.set('Cookie', init.cookie);
	return new IncomingRequest(`${ORIGIN}${path}`, { method: init.method ?? 'GET', headers });
}

const submit = (cookie?: string) => apiRequest('/api/quizzes/q1/submit', { method: 'POST', cookie });

afterEach(() => {
	vi.restoreAllMocks();
});

describe('rate limiting', () => {
	it('answers 429 with Retry-After and never reaches the origin when over the limit', async () => {
		const { env } = makeEnv(false);
		const origin = mockOrigin();

		const response = await worker.fetch(submit('sb-ref-auth-token=a'), env);

		expect(response.status).toBe(429);
		expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
		expect(await response.json()).toMatchObject({ code: 'OVERLOADED' });
		expect(origin).not.toHaveBeenCalled();
	});

	it('keys submits by session, so users sharing an IP get separate buckets', async () => {
		const { env, submit: limit } = makeEnv();
		mockOrigin();

		await worker.fetch(submit('sb-ref-auth-token=base64-userA'), env);
		await worker.fetch(submit('theme=dark; sb-ref-auth-token.0=base64-userB; sb-ref-auth-token.1=rest'), env);
		await worker.fetch(submit('sb-ref-auth-token=base64-userA'), env);

		const [a, b, aAgain] = limit.mock.calls.map(([options]) => options.key);
		expect(a).toMatch(/^s:[0-9a-f]{24}$/);
		expect(b).not.toBe(a);
		expect(aAgain).toBe(a);
	});

	it('falls back to the IP for submits without a session cookie', async () => {
		const { env, submit: limit } = makeEnv();
		mockOrigin();

		await worker.fetch(submit('sb-ref-auth-token-code-verifier=x'), env);

		expect(limit).toHaveBeenCalledWith({ key: `ip:${IP}` });
	});

	it('limits other API calls per session, so a shared carrier IP is not one bucket', async () => {
		const { env, submit: submitLimit, api } = makeEnv();
		mockOrigin();

		await worker.fetch(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=base64-userA' }), env);
		await worker.fetch(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=base64-userB' }), env);

		const [a, b] = api.mock.calls.map(([options]) => options.key);
		expect(a).toMatch(/^s:[0-9a-f]{24}$/);
		expect(b).not.toBe(a);
		expect(submitLimit).not.toHaveBeenCalled();
	});

	it('limits anonymous API calls per IP', async () => {
		const { env, api } = makeEnv();
		mockOrigin();

		await worker.fetch(apiRequest('/api/leaderboard'), env);

		expect(api).toHaveBeenCalledWith({ key: `ip:${IP}` });
	});

	it('applies the per-IP ceiling to every limited request', async () => {
		const { env, perIp } = makeEnv();
		mockOrigin();

		await worker.fetch(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=a' }), env);
		await worker.fetch(submit('sb-ref-auth-token=a'), env);

		expect(perIp.mock.calls).toEqual([[{ key: IP }], [{ key: IP }]]);
	});

	it('answers 429 when the IP is over its ceiling even if the session is not', async () => {
		const { env } = makeEnv(true, false);
		const origin = mockOrigin();

		const response = await worker.fetch(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=fresh' }), env);

		expect(response.status).toBe(429);
		expect(origin).not.toHaveBeenCalled();
	});

	it('never limits the cron endpoint', async () => {
		const { env, submit: submitLimit, api, perIp } = makeEnv(false);
		mockOrigin();

		const response = await worker.fetch(apiRequest('/api/cron/process-scheduled'), env);

		expect(response.status).toBe(200);
		expect(api).not.toHaveBeenCalled();
		expect(submitLimit).not.toHaveBeenCalled();
		expect(perIp).not.toHaveBeenCalled();
	});
});

describe('edge cache', () => {
	it('strips cookies and caches shared GETs', async () => {
		const { env } = makeEnv();
		const origin = mockOrigin();

		await worker.fetch(apiRequest('/api/leaderboard', { cookie: 'sb-ref-auth-token=secret' }), env);

		const [sent, init] = origin.mock.calls[0] as [Request, RequestInit<RequestInitCfProperties>];
		expect(sent.headers.get('Cookie')).toBeNull();
		expect(init.cf).toMatchObject({ cacheEverything: true, cacheTtlByStatus: { '200-299': 30, '500-599': 0 } });
	});

	it('passes per-user requests through with their cookies and no cache override', async () => {
		const { env } = makeEnv();
		const origin = mockOrigin();

		await worker.fetch(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=secret' }), env);

		const [sent, init] = origin.mock.calls[0] as [Request, RequestInit<RequestInitCfProperties>];
		expect(sent.headers.get('Cookie')).toBe('sb-ref-auth-token=secret');
		expect(init.cf).toBeUndefined();
	});
});

describe('origin failures', () => {
	it("turns an origin error into the app's 503 busy response", async () => {
		const { env } = makeEnv();
		mockOrigin(async () => {
			throw new TypeError('Network connection lost');
		});

		const response = await worker.fetch(apiRequest('/api/quizzes'), env);

		expect(response.status).toBe(503);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toMatchObject({ code: 'OVERLOADED' });
	});
});

describe('scheduled', () => {
	it('calls the app scheduler with the cron secret', async () => {
		const { env } = makeEnv();
		const origin = mockOrigin();
		const ctx = createExecutionContext();

		await worker.scheduled(createScheduledController(), env, ctx);
		await waitOnExecutionContext(ctx);

		expect(origin).toHaveBeenCalledWith(`${ORIGIN}/api/cron/process-scheduled`, {
			headers: { Authorization: 'Bearer test-secret' },
		});
	});

	it('logs a failed scheduler call so it is visible in Workers Logs', async () => {
		const { env } = makeEnv();
		mockOrigin(async () => new Response('Unauthorized', { status: 401 }));
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const ctx = createExecutionContext();

		await worker.scheduled(createScheduledController(), env, ctx);
		await waitOnExecutionContext(ctx);

		expect(error).toHaveBeenCalledWith('process-scheduled answered 401');
	});
});
