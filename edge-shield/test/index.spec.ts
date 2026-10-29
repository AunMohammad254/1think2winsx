import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

// A correctly typed incoming `Request` to pass to `worker.fetch()`
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ORIGIN = 'https://1think2win.com';
const IP = '203.0.113.7';

function makeEnv(allow = true, allowIp = allow, { allowOrigin = true, enforce = 'true' as Env['ENFORCE'] } = {}) {
	const submit = vi.fn(async (_options: RateLimitOptions) => ({ success: allow }));
	const api = vi.fn(async (_options: RateLimitOptions) => ({ success: allow }));
	const perIp = vi.fn(async (_options: RateLimitOptions) => ({ success: allowIp }));
	const budget = vi.fn(async (_options: RateLimitOptions) => ({ success: allowOrigin }));
	const env: Env = {
		SUBMIT_LIMITER: { limit: submit },
		API_LIMITER: { limit: api },
		IP_LIMITER: { limit: perIp },
		ORIGIN_LIMITER: { limit: budget },
		SITE_URL: ORIGIN,
		ENFORCE: enforce,
		CRON_SECRET: 'test-secret',
	};
	return { env, submit, api, perIp, budget };
}

/** worker.fetch with a fresh execution context (it calls passThroughOnException on it). */
const call = (request: Request, env: Env, ctx = createExecutionContext()) =>
	worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, env, ctx);

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

		const response = await call(submit('sb-ref-auth-token=a'), env);

		expect(response.status).toBe(429);
		expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
		expect(await response.json()).toMatchObject({ code: 'OVERLOADED' });
		expect(origin).not.toHaveBeenCalled();
	});

	it('keys submits by session, so users sharing an IP get separate buckets', async () => {
		const { env, submit: limit } = makeEnv();
		mockOrigin();

		await call(submit('sb-ref-auth-token=base64-userA'), env);
		await call(submit('theme=dark; sb-ref-auth-token.0=base64-userB; sb-ref-auth-token.1=rest'), env);
		await call(submit('sb-ref-auth-token=base64-userA'), env);

		const [a, b, aAgain] = limit.mock.calls.map(([options]) => options.key);
		expect(a).toMatch(/^s:[0-9a-f]{24}$/);
		expect(b).not.toBe(a);
		expect(aAgain).toBe(a);
	});

	it('falls back to the IP for submits without a session cookie', async () => {
		const { env, submit: limit } = makeEnv();
		mockOrigin();

		await call(submit('sb-ref-auth-token-code-verifier=x'), env);

		expect(limit).toHaveBeenCalledWith({ key: `ip:${IP}` });
	});

	it('limits other API calls per session, so a shared carrier IP is not one bucket', async () => {
		const { env, submit: submitLimit, api } = makeEnv();
		mockOrigin();

		await call(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=base64-userA' }), env);
		await call(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=base64-userB' }), env);

		const [a, b] = api.mock.calls.map(([options]) => options.key);
		expect(a).toMatch(/^s:[0-9a-f]{24}$/);
		expect(b).not.toBe(a);
		expect(submitLimit).not.toHaveBeenCalled();
	});

	it('limits anonymous API calls per IP', async () => {
		const { env, api } = makeEnv();
		mockOrigin();

		await call(apiRequest('/api/prizes'), env);

		expect(api).toHaveBeenCalledWith({ key: `ip:${IP}` });
	});

	it('applies the per-IP ceiling to every limited request', async () => {
		const { env, perIp } = makeEnv();
		mockOrigin();

		await call(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=a' }), env);
		await call(submit('sb-ref-auth-token=a'), env);

		expect(perIp.mock.calls).toEqual([[{ key: IP }], [{ key: IP }]]);
	});

	it('answers 429 when the IP is over its ceiling even if the session is not', async () => {
		const { env } = makeEnv(true, false);
		const origin = mockOrigin();

		const response = await call(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=fresh' }), env);

		expect(response.status).toBe(429);
		expect(origin).not.toHaveBeenCalled();
	});

	it('never limits the cron endpoint, the webhooks or the send-email hook', async () => {
		const { env, submit: submitLimit, api, perIp, budget } = makeEnv(false, false, { allowOrigin: false });
		mockOrigin();

		for (const path of ['/api/cron/process-scheduled', '/api/webhooks/brevo', '/api/webhooks/ses', '/api/auth/send-email-hook']) {
			const response = await call(apiRequest(path, { method: 'POST' }), env);
			expect(response.status).toBe(200);
		}
		expect(api).not.toHaveBeenCalled();
		expect(submitLimit).not.toHaveBeenCalled();
		expect(perIp).not.toHaveBeenCalled();
		expect(budget).not.toHaveBeenCalled();
	});
});

describe("Hostinger's budget", () => {
	it('answers 503 busy without reaching the origin once the budget for this location is spent', async () => {
		const { env, budget } = makeEnv(true, true, { allowOrigin: false });
		const origin = mockOrigin();

		const response = await call(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=a' }), env);

		expect(response.status).toBe(503);
		expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
		expect(await response.json()).toMatchObject({ code: 'OVERLOADED' });
		expect(budget).toHaveBeenCalledWith({ key: 'origin' });
		expect(origin).not.toHaveBeenCalled();
	});

	it('counts only requests that passed the other limits, since only those would reach Hostinger', async () => {
		const { env, budget } = makeEnv(false);
		mockOrigin();

		const response = await call(submit('sb-ref-auth-token=a'), env);

		expect(response.status).toBe(429);
		expect(budget).not.toHaveBeenCalled();
	});
});

describe('log-only mode (ENFORCE=false)', () => {
	it('lets every request through and logs the limit it would have hit', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const origin = mockOrigin();

		await call(submit('sb-ref-auth-token=a'), makeEnv(false, true, { enforce: 'false' }).env);
		await call(apiRequest('/api/quizzes'), makeEnv(true, false, { enforce: 'false' }).env);
		await call(apiRequest('/api/prizes'), makeEnv(true, true, { allowOrigin: false, enforce: 'false' }).env);
		await call(apiRequest('/api/quizzes'), makeEnv(false, true, { enforce: 'false' }).env);

		expect(origin).toHaveBeenCalledTimes(4);
		expect(log.mock.calls.map(([line]) => JSON.parse(line as string))).toEqual([
			{ wouldLimit: 'submit', method: 'POST', path: '/api/quizzes/q1/submit' },
			{ wouldLimit: 'ip', method: 'GET', path: '/api/quizzes' },
			{ wouldLimit: 'origin', method: 'GET', path: '/api/prizes' },
			{ wouldLimit: 'api', method: 'GET', path: '/api/quizzes' },
		]);
	});
});

describe('passing requests on', () => {
	it('passes requests through with their cookies and no cache override (Cache Rules decide caching)', async () => {
		const { env } = makeEnv();
		const origin = mockOrigin();

		await call(apiRequest('/api/quizzes', { cookie: 'sb-ref-auth-token=secret' }), env);

		const [sent, init] = origin.mock.calls[0] as [Request, RequestInit<RequestInitCfProperties>];
		expect(sent.headers.get('Cookie')).toBe('sb-ref-auth-token=secret');
		expect(init.cf).toBeUndefined();
	});
});

describe('origin failures', () => {
	it('hands the request to Hostinger itself if this Worker throws', async () => {
		const { env } = makeEnv();
		mockOrigin();
		const ctx = createExecutionContext();
		const passThrough = vi.spyOn(ctx, 'passThroughOnException');

		await call(apiRequest('/api/quizzes'), env, ctx);

		expect(passThrough).toHaveBeenCalled();
	});

	it("turns an origin error into the app's 503 busy response", async () => {
		const { env } = makeEnv();
		mockOrigin(async () => {
			throw new TypeError('Network connection lost');
		});

		const response = await call(apiRequest('/api/quizzes'), env);

		expect(response.status).toBe(503);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toMatchObject({ code: 'OVERLOADED' });
	});

	it("turns Hostinger's HTML 403 block page into the app's 503 busy response, and logs it", async () => {
		const { env } = makeEnv();
		mockOrigin(async () => new Response('<html>Access denied</html>', { status: 403, headers: { 'content-type': 'text/html; charset=UTF-8' } }));
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await call(apiRequest('/api/quizzes'), env);

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ code: 'OVERLOADED' });
		expect(JSON.parse(error.mock.calls[0][0] as string)).toEqual({ hostingerBlock: true, method: 'GET', path: '/api/quizzes' });
	});

	it("passes the app's own JSON 403s through untouched", async () => {
		const { env } = makeEnv();
		mockOrigin(async () => Response.json({ error: 'Forbidden' }, { status: 403 }));

		const response = await call(apiRequest('/api/live/quizzes/q1'), env);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'Forbidden' });
	});

	it('gives up on a silent origin after 15 s, except for admin work, the scheduler and uploads', async () => {
		vi.useFakeTimers();
		try {
			const { env } = makeEnv();
			// Answers only when aborted
			vi.spyOn(globalThis, 'fetch').mockImplementation(
				(_input, init) =>
					new Promise((_resolve, reject) =>
						(init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
					),
			);

			const quick = call(apiRequest('/api/quizzes'), env);
			const slow = Promise.race([
				call(apiRequest('/api/admin/newsletter/send', { method: 'POST' }), env),
				new Promise((resolve) => setTimeout(() => resolve('still waiting'), 20_000)),
			]);
			await vi.advanceTimersByTimeAsync(20_000);

			expect((await quick).status).toBe(503);
			expect(await slow).toBe('still waiting');
		} finally {
			vi.useRealTimers();
		}
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
