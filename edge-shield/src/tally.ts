/**
 * How many lock-ins the edge accepted (answered 202 and queued) per quiz. Each quiz has TALLY_SHARDS Durable
 * Objects, picked by a hash of the user id, so a burst of 50,000 lock-ins is spread over several objects instead
 * of queueing behind one. GET /api/edge/lockin-status sums them; the app compares that with what was saved.
 */
import { DurableObject } from 'cloudflare:workers';
import { json, sameSecret } from './http';

export const TALLY_SHARDS = 16;
export const STATUS_PATH = '/api/edge/lockin-status';

export class LockinTally extends DurableObject<Env> {
	/** Adds `delta` (negative to take one back) and returns the new count. */
	async add(delta: number): Promise<number> {
		const received = (this.ctx.storage.kv.get<number>('received') ?? 0) + delta;
		this.ctx.storage.kv.put('received', received);
		return received;
	}

	async get(): Promise<number> {
		return this.ctx.storage.kv.get<number>('received') ?? 0;
	}
}

/** FNV-1a, 32-bit: a stable, cheap spread of user ids over the shards. */
function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function tallyShardName(quizId: string, userId: string): string {
	return `${quizId}:${fnv1a(userId) % TALLY_SHARDS}`;
}

export function tallyFor(env: Env, quizId: string, userId: string): DurableObjectStub<LockinTally> {
	return env.LOCKIN_TALLY.getByName(tallyShardName(quizId, userId));
}

/** GET /api/edge/lockin-status?quiz=<id>, with the scheduler's `Authorization: Bearer ${CRON_SECRET}`. */
export async function lockinStatus(request: Request, env: Env, url: URL): Promise<Response> {
	if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
	const given = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
	if (!env.CRON_SECRET || !given || !sameSecret(given, env.CRON_SECRET)) {
		return json({ error: 'Unauthorized', code: 'unauthorized' }, 401);
	}
	const quizId = url.searchParams.get('quiz');
	if (!quizId || quizId.length > 100) return json({ error: 'Missing or invalid quiz' }, 400);
	const counts = await Promise.all(
		Array.from({ length: TALLY_SHARDS }, (_, shard) => env.LOCKIN_TALLY.getByName(`${quizId}:${shard}`).get()),
	);
	return json({ quizId, received: counts.reduce((sum, count) => sum + count, 0) });
}
