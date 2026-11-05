import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JWKS_REFETCH_GAP_MS, resetJwksCache } from '../src/jwt';
import { readAnswers } from '../src/lockin';
import { tallyShardName } from '../src/tally';
import {
	call,
	COOKIE,
	IP,
	KID,
	lockinRequest,
	makeEnv,
	newKeyPair,
	publicJwk,
	sentMessages,
	sessionCookie,
	signToken,
	SITE,
	stubFetch,
	USER,
} from './helpers';

let signing: CryptoKeyPair;
let jwks: Record<string, unknown>[];

beforeAll(async () => {
	signing = await newKeyPair();
	jwks = [await publicJwk(signing)];
});

beforeEach(() => {
	resetJwksCache();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

const jwksResponse = () => Response.json({ keys: jwks });
let quizCounter = 0;
/** A fresh quiz id per test, so tallies never mix. */
const newQuiz = () => `quiz-${Date.now()}-${++quizCounter}`;

async function validCookie(claims: Record<string, unknown> = {}, options?: Parameters<typeof sessionCookie>[1]) {
	return sessionCookie(await signToken(signing, claims), options);
}

async function received(env: Env, quizId: string, userId = USER): Promise<number> {
	return env.LOCKIN_TALLY.getByName(tallyShardName(quizId, userId)).get();
}

describe('session check', () => {
	it('accepts a valid ES256 session and queues the lock-in under its user id', async () => {
		const { env, queueSend } = makeEnv();
		const { originCalls, jwksCalls } = stubFetch(jwksResponse);
		const quiz = newQuiz();

		const response = await call(lockinRequest(quiz, { cookie: await validCookie() }), env);

		expect(response.status).toBe(202);
		expect(sentMessages(queueSend)[0].u).toBe(USER);
		expect(jwksCalls).toHaveLength(1);
		expect(originCalls).toEqual([]);
	});

	it('answers session_expired for an expired token signed by the right key', async () => {
		const { env, queueSend } = makeEnv();
		stubFetch(jwksResponse);

		const cookie = await validCookie({ exp: Math.floor(Date.now() / 1000) - 5 });
		const response = await call(lockinRequest(newQuiz(), { cookie }), env);

		expect(response.status).toBe(401);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toMatchObject({ code: 'session_expired' });
		expect(queueSend).not.toHaveBeenCalled();
	});

	it('refuses a token signed by another key under the same kid', async () => {
		const { env, queueSend } = makeEnv();
		stubFetch(jwksResponse);
		const forger = await newKeyPair();

		const cookie = sessionCookie(await signToken(forger));
		const response = await call(lockinRequest(newQuiz(), { cookie }), env);

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: 'unauthorized' });
		expect(queueSend).not.toHaveBeenCalled();
	});

	it('refuses an expired token from another key as unauthorized, not session_expired', async () => {
		const { env } = makeEnv();
		stubFetch(jwksResponse);
		const forger = await newKeyPair();

		const cookie = sessionCookie(await signToken(forger, { exp: 1 }));
		const response = await call(lockinRequest(newQuiz(), { cookie }), env);

		expect(await response.json()).toMatchObject({ code: 'unauthorized' });
	});

	it('answers unauthorized without a session cookie, and fetches no keys', async () => {
		const { env, queueSend } = makeEnv();
		const { jwksCalls, originCalls } = stubFetch(jwksResponse);

		for (const cookie of [undefined, 'theme=dark', `${COOKIE}-code-verifier=abc`, 'sb-otherproject-auth-token=base64-e30']) {
			const response = await call(lockinRequest(newQuiz(), { cookie }), env);
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({ error: 'Authentication required', code: 'unauthorized' });
		}
		expect(jwksCalls).toEqual([]);
		expect(originCalls).toEqual([]);
		expect(queueSend).not.toHaveBeenCalled();
	});

	it('answers unauthorized for an unreadable cookie or token', async () => {
		const { env } = makeEnv();
		stubFetch(jwksResponse);
		const token = await signToken(signing);
		const [head, body] = token.split('.');

		for (const cookie of [
			`${COOKIE}=base64-%%%`,
			`${COOKIE}=base64-${btoa('not json')}`,
			sessionCookie('not-a-jwt'),
			sessionCookie(`${head}.${body}`),
			sessionCookie(`${head}.${body}.c2hvcnQ`),
		]) {
			const response = await call(lockinRequest(newQuiz(), { cookie }), env);
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({ code: 'unauthorized' });
		}
	});

	it('reads a chunked base64- cookie (sb-<ref>-auth-token.0, .1, .2)', async () => {
		const { env, queueSend } = makeEnv();
		stubFetch(jwksResponse);

		const cookie = `theme=dark; ${await validCookie({}, { chunks: 3 })}; other=1`;
		expect(cookie).toContain(`${COOKIE}.2=`);
		const response = await call(lockinRequest(newQuiz(), { cookie }), env);

		expect(response.status).toBe(202);
		expect(sentMessages(queueSend)[0].u).toBe(USER);
	});

	it('reads an unprefixed, URI-encoded JSON cookie from older versions', async () => {
		const { env } = makeEnv();
		stubFetch(jwksResponse);

		const response = await call(lockinRequest(newQuiz(), { cookie: await validCookie({}, { encoding: 'raw' }) }), env);

		expect(response.status).toBe(202);
	});

	it('checks the issuer, the audience and the subject', async () => {
		const { env } = makeEnv();
		stubFetch(jwksResponse);

		for (const claims of [
			{ iss: 'https://other.supabase.co/auth/v1' },
			{ aud: 'anon' },
			{ aud: undefined },
			{ sub: '' },
			{ sub: undefined },
			{ exp: undefined },
		]) {
			const response = await call(lockinRequest(newQuiz(), { cookie: await validCookie(claims) }), env);
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({ code: 'unauthorized' });
		}
	});

	it('accepts an audience list that includes authenticated', async () => {
		const { env } = makeEnv();
		stubFetch(jwksResponse);

		const response = await call(lockinRequest(newQuiz(), { cookie: await validCookie({ aud: ['authenticated', 'other'] }) }), env);

		expect(response.status).toBe(202);
	});

	it('refuses tokens that are not ES256 or have no kid', async () => {
		const { env } = makeEnv();
		stubFetch(jwksResponse);

		for (const header of [{ alg: 'HS256' }, { alg: 'none' }, { kid: undefined }]) {
			const cookie = sessionCookie(await signToken(signing, {}, header));
			const response = await call(lockinRequest(newQuiz(), { cookie }), env);
			expect(await response.json()).toMatchObject({ code: 'unauthorized' });
		}
	});

	it('caches the key set, and refetches it after 10 minutes', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
		const { env } = makeEnv();
		const { jwksCalls } = stubFetch(jwksResponse);
		const cookie = await validCookie({ exp: Math.floor(Date.now() / 1000) + 7200 });

		for (let i = 0; i < 3; i++) await call(lockinRequest(newQuiz(), { cookie }), env);
		expect(jwksCalls).toHaveLength(1);

		vi.setSystemTime(new Date('2026-11-04T10:10:01Z'));
		expect((await call(lockinRequest(newQuiz(), { cookie }), env)).status).toBe(202);
		expect(jwksCalls).toHaveLength(2);
	});

	it('refetches the key set for an unknown kid (a rotated key), at most once per gap', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
		const { env } = makeEnv();
		const { jwksCalls } = stubFetch(jwksResponse);
		const rotated = await newKeyPair();
		const rotatedCookie = sessionCookie(await signToken(rotated, { exp: Math.floor(Date.now() / 1000) + 7200 }, { kid: 'test-key-2' }));

		await call(lockinRequest(newQuiz(), { cookie: await validCookie() }), env);
		// Within the gap after a fetch, an unknown kid is refused without fetching again
		expect((await call(lockinRequest(newQuiz(), { cookie: rotatedCookie }), env)).status).toBe(401);
		expect(jwksCalls).toHaveLength(1);
		// The new key isn't published yet: one refetch, then no more within the gap
		vi.setSystemTime(Date.now() + JWKS_REFETCH_GAP_MS);
		expect((await call(lockinRequest(newQuiz(), { cookie: rotatedCookie }), env)).status).toBe(401);
		expect((await call(lockinRequest(newQuiz(), { cookie: rotatedCookie }), env)).status).toBe(401);
		expect(jwksCalls).toHaveLength(2);

		jwks = [...jwks, await publicJwk(rotated, 'test-key-2')];
		try {
			vi.setSystemTime(Date.now() + JWKS_REFETCH_GAP_MS);
			expect((await call(lockinRequest(newQuiz(), { cookie: rotatedCookie }), env)).status).toBe(202);
			expect(jwksCalls).toHaveLength(3);
		} finally {
			jwks = jwks.slice(0, 1);
		}
	});

	it('answers busy (503) when the keys cannot be fetched, and keeps using cached keys when a refresh fails', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		let up = false;
		const { env } = makeEnv();
		const { originCalls } = stubFetch(() => (up ? jwksResponse() : new Response('down', { status: 500 })));
		const cookie = await validCookie({ exp: Math.floor(Date.now() / 1000) + 7200 });

		const down = await call(lockinRequest(newQuiz(), { cookie }), env);
		expect(down.status).toBe(503);
		expect(await down.json()).toMatchObject({ code: 'OVERLOADED' });
		expect(originCalls).toEqual([]);

		up = true;
		expect((await call(lockinRequest(newQuiz(), { cookie }), env)).status).toBe(202);

		up = false;
		vi.setSystemTime(new Date('2026-11-04T10:30:00Z'));
		expect((await call(lockinRequest(newQuiz(), { cookie }), env)).status).toBe(202);
		expect(error.mock.calls.some(([line]) => String(line).includes('jwksFetchFailed'))).toBe(true);
	});
});

describe('routing', () => {
	it('refuses a lock-in from another Origin, or with none, before reading the session', async () => {
		const { env, queueSend } = makeEnv();
		const { jwksCalls, originCalls } = stubFetch(jwksResponse);
		const cookie = await validCookie();

		for (const origin of ['https://evil.example', 'https://www.1think2win.com', 'null', null]) {
			const response = await call(lockinRequest(newQuiz(), { cookie, origin }), env);
			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({ error: 'Forbidden', code: 'forbidden' });
		}
		expect(jwksCalls).toEqual([]);
		expect(originCalls).toEqual([]);
		expect(queueSend).not.toHaveBeenCalled();
	});

	it('sends lock-ins and CSRF tokens to Hostinger as before when LOCKIN_EDGE is not "true"', async () => {
		const { env, queueSend, limiters } = makeEnv({ lockinEdge: 'false' });
		const { originCalls } = stubFetch(jwksResponse);
		const quiz = newQuiz();

		const submit = await call(lockinRequest(quiz, { cookie: await validCookie() }), env);
		const csrf = await call(new Request(`${SITE}/api/csrf-token`, { headers: { 'CF-Connecting-IP': IP } }), env);

		expect(await submit.text()).toBe('origin');
		expect(await csrf.text()).toBe('origin');
		expect(originCalls).toEqual([`${SITE}/api/quizzes/${quiz}/submit`, `${SITE}/api/csrf-token`]);
		expect(queueSend).not.toHaveBeenCalled();
		expect(limiters.budget).toHaveBeenCalledTimes(2);
		expect(await received(env, quiz)).toBe(0);
	});

	it('sends match overs (X-Lockin-Direct: 1) to Hostinger with the usual limits', async () => {
		const { env, queueSend, limiters } = makeEnv();
		const { originCalls } = stubFetch(jwksResponse);
		const quiz = newQuiz();

		const response = await call(lockinRequest(quiz, { cookie: await validCookie(), headers: { 'X-Lockin-Direct': '1' } }), env);

		expect(await response.text()).toBe('origin');
		expect(originCalls).toEqual([`${SITE}/api/quizzes/${quiz}/submit`]);
		expect(queueSend).not.toHaveBeenCalled();
		expect(limiters.submit).toHaveBeenCalledTimes(1);
		expect(limiters.perIp).toHaveBeenCalledTimes(1);
		expect(limiters.budget).toHaveBeenCalledTimes(1);
	});

	it('leaves other requests to the origin: other methods and paths', async () => {
		const { env, queueSend } = makeEnv();
		const { originCalls } = stubFetch(jwksResponse);

		await call(new Request(`${SITE}/api/quizzes/q1/submit`, { method: 'GET' }), env);
		await call(new Request(`${SITE}/api/quizzes/q1/submit/extra`, { method: 'POST', headers: { Origin: SITE } }), env);
		await call(new Request(`${SITE}/api/csrf-token`, { method: 'POST', headers: { Origin: SITE } }), env);

		expect(originCalls).toHaveLength(3);
		expect(queueSend).not.toHaveBeenCalled();
	});
});

describe('lock-in intake', () => {
	it('answers 202 in the app shape, queues the message with the receive time, and bumps the tally', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-04T10:00:00.123Z'));
		const { env, queueSend, limiters } = makeEnv();
		stubFetch(jwksResponse);
		const quiz = newQuiz();
		const cookie = await validCookie();

		const response = await call(
			lockinRequest(quiz, {
				cookie,
				body: {
					answers: [
						{ questionId: 'question-1', selectedOption: 2 },
						{ questionId: 'question-2', selectedOption: -1 },
						{ questionId: 'question-3', selectedOption: 0, extra: 'dropped' },
					],
				},
			}),
			env,
		);

		expect(response.status).toBe(202);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toEqual({
			message: 'Answer received',
			results: {
				attemptId: null,
				score: null,
				points: null,
				totalQuestions: null,
				submittedAnswers: 2,
				status: 'received',
				isReattempt: null,
				note: expect.stringContaining('received'),
			},
		});
		expect(queueSend).toHaveBeenCalledTimes(1);
		expect(queueSend.mock.calls[0][0]).toEqual({
			q: quiz,
			u: USER,
			t: '2026-11-04T10:00:00.123Z',
			a: [
				{ q: 'question-1', o: 2 },
				{ q: 'question-3', o: 0 },
			],
		});
		expect(await received(env, quiz)).toBe(1);
		// The per-session submit limit applies; the per-IP ceiling and Hostinger's budget don't
		expect(limiters.submit).toHaveBeenCalledWith({ key: expect.stringMatching(/^s:[0-9a-f]{24}$/) });
		expect(limiters.perIp).not.toHaveBeenCalled();
		expect(limiters.budget).not.toHaveBeenCalled();
	});

	it('decodes the quiz id from the path', async () => {
		const { env, queueSend } = makeEnv();
		stubFetch(jwksResponse);

		await call(lockinRequest('quiz%20one', { cookie: await validCookie() }), env);

		expect(sentMessages(queueSend)[0].q).toBe('quiz one');
	});

	it('counts each accepted lock-in, including resends', async () => {
		const { env } = makeEnv();
		stubFetch(jwksResponse);
		const quiz = newQuiz();
		const cookie = await validCookie();

		for (let i = 0; i < 3; i++) expect((await call(lockinRequest(quiz, { cookie }), env)).status).toBe(202);

		expect(await received(env, quiz)).toBe(3);
	});

	it('answers busy (503) and takes the 1 back off the tally when the queue refuses the message', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { env, queueSend } = makeEnv({
			send: async () => {
				throw new Error('Queue send failed: too many requests');
			},
		});
		const { originCalls } = stubFetch(jwksResponse);
		const quiz = newQuiz();

		const response = await call(lockinRequest(quiz, { cookie: await validCookie() }), env);

		expect(response.status).toBe(503);
		expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
		expect(await response.json()).toMatchObject({ code: 'OVERLOADED' });
		expect(queueSend).toHaveBeenCalledTimes(1);
		expect(await received(env, quiz)).toBe(0);
		expect(originCalls).toEqual([]);
		expect(error.mock.calls.some(([line]) => String(line).includes('lockinQueueFailed'))).toBe(true);
	});

	it('answers busy (503), not Hostinger, on an unexpected fault', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { env } = makeEnv();
		const broken = { ...env, LOCKIN_TALLY: undefined as unknown as Env['LOCKIN_TALLY'] };
		const { originCalls } = stubFetch(jwksResponse);

		const response = await call(lockinRequest(newQuiz(), { cookie: await validCookie() }), broken);

		expect(response.status).toBe(503);
		expect(originCalls).toEqual([]);
	});

	it('answers 429 over the per-session submit limit, and only logs it in log-only mode', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		stubFetch(jwksResponse);
		const cookie = await validCookie();

		const limited = makeEnv({ limits: { submit: false } });
		const quiz = newQuiz();
		const response = await call(lockinRequest(quiz, { cookie }), limited.env);
		expect(response.status).toBe(429);
		expect(await response.json()).toMatchObject({ code: 'OVERLOADED' });
		expect(limited.queueSend).not.toHaveBeenCalled();
		expect(await received(limited.env, quiz)).toBe(0);

		const logOnly = makeEnv({ limits: { submit: false }, enforce: 'false' });
		const quiz2 = newQuiz();
		expect((await call(lockinRequest(quiz2, { cookie }), logOnly.env)).status).toBe(202);
		expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
			wouldLimit: 'submit',
			method: 'POST',
			path: `/api/quizzes/${quiz2}/submit`,
		});
	});

	it('is not held back by the per-IP ceiling or Hostinger budget', async () => {
		const { env } = makeEnv({ limits: { ip: false, origin: false, api: false } });
		stubFetch(jwksResponse);

		expect((await call(lockinRequest(newQuiz(), { cookie: await validCookie() }), env)).status).toBe(202);
	});

	it.each([
		['not JSON', '{"answers": [', 'Invalid JSON body'],
		['no answers', {}, 'Invalid answers'],
		['an empty list', { answers: [] }, 'Invalid answers'],
		[
			'only unanswered questions',
			{ answers: [{ questionId: 'q1', selectedOption: -1 }] },
			'Answer at least one question before submitting',
		],
		['an option above 9', { answers: [{ questionId: 'q1', selectedOption: 10 }] }, 'Invalid answers'],
		['a fractional option', { answers: [{ questionId: 'q1', selectedOption: 1.5 }] }, 'Invalid answers'],
		['an option as a string', { answers: [{ questionId: 'q1', selectedOption: '1' }] }, 'Invalid answers'],
		['an empty question id', { answers: [{ questionId: '', selectedOption: 1 }] }, 'Invalid answers'],
		['a 101-character question id', { answers: [{ questionId: 'x'.repeat(101), selectedOption: 1 }] }, 'Invalid answers'],
		['201 answers', { answers: Array.from({ length: 201 }, (_, i) => ({ questionId: `q${i}`, selectedOption: 1 })) }, 'Invalid answers'],
		['a list body', [{ questionId: 'q1', selectedOption: 1 }], 'Invalid answers'],
	])('answers 400 for %s, and queues nothing', async (_name, body, error) => {
		const { env, queueSend } = makeEnv();
		stubFetch(jwksResponse);
		const quiz = newQuiz();

		const response = await call(lockinRequest(quiz, { cookie: await validCookie(), body }), env);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error });
		expect(queueSend).not.toHaveBeenCalled();
		expect(await received(env, quiz)).toBe(0);
	});

	it('accepts 200 answers and 100-character question ids, like the app', () => {
		const answers = Array.from({ length: 200 }, (_, i) => ({ questionId: `${i}`.padEnd(100, 'x'), selectedOption: i % 10 }));
		expect(readAnswers({ answers })).toEqual({ answers });
	});

	it('names the invalid fields', () => {
		expect(
			readAnswers({
				answers: [
					{ questionId: 'ok', selectedOption: 3 },
					{ questionId: 5, selectedOption: 12 },
				],
			}),
		).toEqual({
			error: 'Invalid answers',
			details: [
				{ path: ['answers', 1, 'questionId'], message: expect.any(String) },
				{ path: ['answers', 1, 'selectedOption'], message: expect.any(String) },
			],
		});
	});

	it('answers 413 for a body over 64 KB', async () => {
		const { env, queueSend } = makeEnv();
		stubFetch(jwksResponse);

		const body = JSON.stringify({ answers: [{ questionId: 'q1', selectedOption: 1 }], pad: 'x'.repeat(70_000) });
		const response = await call(lockinRequest(newQuiz(), { cookie: await validCookie(), body }), env);

		expect(response.status).toBe(413);
		expect(queueSend).not.toHaveBeenCalled();
	});
});

describe('CSRF tokens at the edge', () => {
	it('answers GET /api/csrf-token itself with a token the app accepts', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
		const { env, limiters } = makeEnv();
		const { originCalls } = stubFetch(jwksResponse);
		const get = () => call(new Request(`${SITE}/api/csrf-token`, { headers: { 'CF-Connecting-IP': IP } }), env);

		const response = await get();
		const { csrfToken, expiresAt } = (await response.json()) as { csrfToken: string; expiresAt: number };
		const { csrfToken: second } = (await (await get()).json()) as { csrfToken: string };

		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		// MIN_TOKEN_LENGTH and TOKEN_PATTERN in src/lib/csrf-protection.ts; 32 bytes are 43 base64url characters
		expect(csrfToken).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(csrfToken).toHaveLength(43);
		expect(second).not.toBe(csrfToken);
		expect(expiresAt).toBe(Date.parse('2026-11-04T11:00:00Z'));
		expect(originCalls).toEqual([]);
		expect(limiters.api).not.toHaveBeenCalled();
	});
});
