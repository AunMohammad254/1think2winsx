import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chunkByQuiz } from '../src/consumer';
import worker from '../src/index';
import type { LockinMessage } from '../src/lockin';
import { TALLY_SHARDS, tallyShardName } from '../src/tally';
import { call, makeEnv, SITE, SUPABASE_URL, urlOf } from './helpers';

const RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/submit_lockin_batch`;

afterEach(() => {
	vi.restoreAllMocks();
});

const lockin = (quiz: string, user: string, t = '2026-11-04T10:00:00.000Z'): LockinMessage => ({
	q: quiz,
	u: user,
	t,
	a: [{ q: 'question-1', o: 1 }],
});

function batchOf(bodies: unknown[]) {
	return createMessageBatch<LockinMessage>(
		'lockins',
		bodies.map((body, i) => ({ id: `m${i}`, timestamp: new Date('2026-11-04T10:00:00Z'), attempts: 1, body: body as LockinMessage })),
	);
}

type RpcCall = { url: string; headers: Headers; body: { p_quiz_id: string; p_items: Array<{ u: string; t: string; a: unknown }> } };

/** Stubs Supabase: `answer` gets each RPC call and returns its response. */
function stubRpc(answer: (rpc: RpcCall) => Promise<Response> | Response) {
	const calls: RpcCall[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const request = new Request(input as RequestInfo | URL, init as RequestInit);
		const rpc = { url: urlOf(input as RequestInfo | URL), headers: request.headers, body: await request.json() } as RpcCall;
		calls.push(rpc);
		return answer(rpc);
	});
	return calls;
}

const saved = (rpc: RpcCall) => Response.json(rpc.body.p_items.map(({ u }) => ({ u, s: 'saved', n: 1 })));

/** Runs the consumer; `retryMessages` gets each retry's delay (getQueueResult records only the ids). */
async function consume(batch: MessageBatch<LockinMessage>, env: Env) {
	const delays = new Map<string, number | undefined>();
	for (const message of batch.messages) {
		const retry = message.retry.bind(message);
		vi.spyOn(message, 'retry').mockImplementation((options) => {
			delays.set(message.id, options?.delaySeconds);
			retry(options);
		});
	}
	const ctx = createExecutionContext();
	await worker.queue(batch, env);
	const result = await getQueueResult(batch, ctx);
	return { ...result, retryMessages: result.retryMessages.map(({ msgId }) => ({ msgId, delaySeconds: delays.get(msgId) })) };
}

describe('queue consumer', () => {
	it('groups by quiz in chunks of up to 100 and calls submit_lockin_batch with the service role', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { env } = makeEnv();
		const calls = stubRpc(saved);
		const bodies = [
			...Array.from({ length: 110 }, (_, i) => lockin('quiz-a', `user-a${i}`)),
			...Array.from({ length: 20 }, (_, i) => lockin('quiz-b', `user-b${i}`)),
		].sort((x, y) => x.u.localeCompare(y.u)); // interleaved, like a real batch

		const result = await consume(batchOf(bodies), env);

		expect(calls.map(({ body }) => [body.p_quiz_id, body.p_items.length])).toEqual([
			['quiz-a', 100],
			['quiz-a', 10],
			['quiz-b', 20],
		]);
		for (const { url, headers } of calls) {
			expect(url).toBe(RPC_URL);
			expect(headers.get('apikey')).toBe('service-role-key');
			expect(headers.get('Authorization')).toBe('Bearer service-role-key');
			expect(headers.get('Content-Type')).toBe('application/json');
		}
		expect(calls[0].body.p_items[0]).toEqual({
			u: bodies.find((b) => b.q === 'quiz-a')!.u,
			t: '2026-11-04T10:00:00.000Z',
			a: [{ q: 'question-1', o: 1 }],
		});
		expect(result.explicitAcks).toHaveLength(130);
		expect(result.retryMessages).toEqual([]);
		expect(log.mock.calls.map(([line]) => JSON.parse(line as string))).toContainEqual({
			lockinBatch: { quiz: 'quiz-b', items: 20, statuses: { saved: 20 } },
		});
	});

	it('logs the count of each status the database returns', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { env } = makeEnv();
		const verdicts = ['saved', 'saved', 'reattempt', 'duplicate', 'closed', 'entries_closed', 'invalid', 'payment_required', 'not_found'];
		stubRpc((rpc) => Response.json(rpc.body.p_items.map(({ u }, i) => ({ u, s: verdicts[i], n: verdicts[i] === 'saved' ? 1 : 0 }))));

		const result = await consume(batchOf(verdicts.map((_, i) => lockin('quiz-c', `user-${i}`))), env);

		expect(result.explicitAcks).toHaveLength(verdicts.length);
		expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
			lockinBatch: {
				quiz: 'quiz-c',
				items: 9,
				statuses: { saved: 2, reattempt: 1, duplicate: 1, closed: 1, entries_closed: 1, invalid: 1, payment_required: 1, not_found: 1 },
			},
		});
	});

	it('retries only the chunk that failed, after 5 s', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { env } = makeEnv();
		stubRpc((rpc) => (rpc.body.p_quiz_id === 'quiz-down' ? new Response('{"message":"timeout"}', { status: 503 }) : saved(rpc)));

		const result = await consume(
			batchOf([lockin('quiz-ok', 'u1'), lockin('quiz-down', 'u2'), lockin('quiz-ok', 'u3'), lockin('quiz-down', 'u4')]),
			env,
		);

		expect(result.explicitAcks.sort()).toEqual(['m0', 'm2']);
		expect(result.retryMessages.sort((a, b) => a.msgId.localeCompare(b.msgId))).toEqual([
			{ msgId: 'm1', delaySeconds: 5 },
			{ msgId: 'm3', delaySeconds: 5 },
		]);
		expect(JSON.parse(error.mock.calls[0][0] as string)).toEqual({
			lockinBatchRetry: { quiz: 'quiz-down', items: 2, status: 503, body: '{"message":"timeout"}' },
		});
	});

	it('retries when Supabase cannot be reached, or answers 4xx (e.g. the function is missing)', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { env } = makeEnv();

		vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Network connection lost'));
		const unreachable = await consume(batchOf([lockin('quiz-d', 'u1')]), env);
		expect(unreachable.retryMessages).toEqual([{ msgId: 'm0', delaySeconds: 5 }]);
		expect(unreachable.explicitAcks).toEqual([]);

		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		stubRpc(() => Response.json({ code: 'PGRST202', message: 'Could not find the function' }, { status: 404 }));
		const missing = await consume(batchOf([lockin('quiz-d', 'u1')]), env);
		expect(missing.retryMessages).toEqual([{ msgId: 'm0', delaySeconds: 5 }]);
		expect(missing.explicitAcks).toEqual([]);
	});

	it('acks a saved chunk even if the answer body is unreadable (the database already committed)', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { env } = makeEnv();
		stubRpc(() => new Response('not json', { status: 200 }));

		const result = await consume(batchOf([lockin('quiz-e', 'u1')]), env);

		expect(result.explicitAcks).toEqual(['m0']);
		expect(error.mock.calls.some(([line]) => String(line).includes('lockinBatchUnreadable'))).toBe(true);
	});

	it('retries a malformed message alone (it ends in the dead-letter queue), saving the rest', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { env } = makeEnv();
		const calls = stubRpc(saved);

		const result = await consume(batchOf([lockin('quiz-f', 'u1'), { q: 'quiz-f' }, 'garbage']), env);

		expect(calls).toHaveLength(1);
		expect(calls[0].body.p_items).toHaveLength(1);
		expect(result.explicitAcks).toEqual(['m0']);
		expect(result.retryMessages.map(({ msgId }) => msgId).sort()).toEqual(['m1', 'm2']);
	});

	it('chunks keep arrival order within a quiz', () => {
		const messages = ['a', 'b', 'a', 'a', 'b'].map((q, i) => ({ body: lockin(q, `u${i}`) }));
		expect(chunkByQuiz(messages, 2).map(({ quizId, messages: m }) => [quizId, m.map(({ body }) => body.u)])).toEqual([
			['a', ['u0', 'u2']],
			['a', ['u3']],
			['b', ['u1', 'u4']],
		]);
	});
});

describe('received tally', () => {
	it('adds and takes back per shard, spreading users over 16 shards', async () => {
		const { env } = makeEnv();
		const shard = env.LOCKIN_TALLY.getByName('quiz-t:3');

		expect(await shard.get()).toBe(0);
		expect(await shard.add(1)).toBe(1);
		expect(await shard.add(1)).toBe(2);
		expect(await shard.add(-1)).toBe(1);
		expect(await shard.get()).toBe(1);

		const shards = new Set(Array.from({ length: 2000 }, (_, i) => tallyShardName('quiz-t', `user-${i}`)));
		expect(shards.size).toBe(TALLY_SHARDS);
		expect(tallyShardName('quiz-t', 'same-user')).toBe(tallyShardName('quiz-t', 'same-user'));
		expect([...shards].every((name) => /^quiz-t:(\d|1[0-5])$/.test(name))).toBe(true);
	});
});

describe('GET /api/edge/lockin-status', () => {
	const status = (query: string, authorization?: string, method = 'GET') =>
		new Request(`${SITE}/api/edge/lockin-status${query}`, {
			method,
			headers: authorization ? { Authorization: authorization } : {},
		});

	it('sums the shards for the scheduler secret', async () => {
		const { env } = makeEnv();
		await env.LOCKIN_TALLY.getByName('quiz-s:0').add(3);
		await env.LOCKIN_TALLY.getByName('quiz-s:15').add(2);
		await env.LOCKIN_TALLY.getByName('quiz-other:0').add(7);
		const origin = vi.spyOn(globalThis, 'fetch');

		const response = await call(status('?quiz=quiz-s', 'Bearer test-secret'), env);

		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toEqual({ quizId: 'quiz-s', received: 5 });
		expect(origin).not.toHaveBeenCalled();
	});

	it('refuses a missing or wrong secret', async () => {
		const { env } = makeEnv();
		const origin = vi.spyOn(globalThis, 'fetch');

		for (const authorization of [undefined, 'Bearer wrong-secret', 'Bearer test-secret-and-more', 'test-secret', 'Basic test-secret']) {
			const response = await call(status('?quiz=quiz-s', authorization), env);
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({ code: 'unauthorized' });
		}
		const unset = makeEnv().env;
		unset.CRON_SECRET = '';
		expect((await call(status('?quiz=quiz-s', 'Bearer '), unset)).status).toBe(401);
		expect(origin).not.toHaveBeenCalled();
	});

	it('is never rate-limited and answers with LOCKIN_EDGE off too', async () => {
		const { env, limiters } = makeEnv({ lockinEdge: 'false', limits: { submit: false, api: false, ip: false, origin: false } });

		const response = await call(status('?quiz=quiz-none', 'Bearer test-secret'), env);

		expect(await response.json()).toEqual({ quizId: 'quiz-none', received: 0 });
		for (const limit of Object.values(limiters)) expect(limit).not.toHaveBeenCalled();
	});

	it('needs a quiz id, and only answers GET', async () => {
		const { env } = makeEnv();

		expect((await call(status('', 'Bearer test-secret'), env)).status).toBe(400);
		expect((await call(status(`?quiz=${'x'.repeat(101)}`, 'Bearer test-secret'), env)).status).toBe(400);
		const post = await call(status('?quiz=quiz-s', 'Bearer test-secret', 'POST'), env);
		expect(post.status).toBe(405);
		expect(post.headers.get('Allow')).toBe('GET');
	});
});
