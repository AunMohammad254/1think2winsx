/**
 * The `lockins` queue consumer: saves lock-ins in batches through Supabase's submit_lockin_batch (service_role
 * only), which judges each one by its edge receive time `t` and answers one status per item. A chunk that fails
 * is retried after 5 s; after max_retries (wrangler.toml) its messages go to the dead-letter queue, never dropped.
 */
import type { LockinMessage } from './lockin';

export const RPC_CHUNK = 100;
const RETRY_DELAY_SECONDS = 5;
const RPC_TIMEOUT_MS = 30_000;

type ItemResult = { u?: unknown; s?: unknown; n?: unknown };

function isLockin(body: unknown): body is LockinMessage {
	const m = body as Partial<LockinMessage> | null;
	return (
		m !== null &&
		typeof m === 'object' &&
		typeof m.q === 'string' &&
		typeof m.u === 'string' &&
		typeof m.t === 'string' &&
		Array.isArray(m.a)
	);
}

/** Messages grouped by quiz, in arrival order, split into chunks of at most `size`. */
export function chunkByQuiz<M extends { body: LockinMessage }>(
	messages: readonly M[],
	size = RPC_CHUNK,
): Array<{ quizId: string; messages: M[] }> {
	const byQuiz = new Map<string, M[]>();
	for (const message of messages) {
		const group = byQuiz.get(message.body.q);
		if (group) group.push(message);
		else byQuiz.set(message.body.q, [message]);
	}
	const chunks: Array<{ quizId: string; messages: M[] }> = [];
	for (const [quizId, group] of byQuiz) {
		for (let i = 0; i < group.length; i += size) chunks.push({ quizId, messages: group.slice(i, i + size) });
	}
	return chunks;
}

async function saveChunk(env: Env, quizId: string, messages: Array<Message<LockinMessage>>): Promise<void> {
	const retry = (reason: Record<string, unknown>) => {
		console.error(JSON.stringify({ lockinBatchRetry: { quiz: quizId, items: messages.length, ...reason } }));
		for (const message of messages) message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
	};
	let response: Response;
	try {
		response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/submit_lockin_batch`, {
			method: 'POST',
			headers: {
				apikey: env.SUPABASE_SERVICE_ROLE_KEY,
				Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ p_quiz_id: quizId, p_items: messages.map(({ body: { u, t, a } }) => ({ u, t, a })) }),
			signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
		});
	} catch (error) {
		return retry({ error: String(error) });
	}
	if (!response.ok) return retry({ status: response.status, body: (await response.text().catch(() => '')).slice(0, 500) });

	// Saved: the statuses are the database's verdicts, so a parse problem here is logged, not retried
	for (const message of messages) message.ack();
	const statuses: Record<string, number> = {};
	try {
		const results = (await response.json()) as ItemResult[];
		for (const { s } of Array.isArray(results) ? results : []) {
			const status = typeof s === 'string' ? s : 'unknown';
			statuses[status] = (statuses[status] ?? 0) + 1;
		}
	} catch (error) {
		console.error(JSON.stringify({ lockinBatchUnreadable: { quiz: quizId, items: messages.length, error: String(error) } }));
		return;
	}
	console.log(JSON.stringify({ lockinBatch: { quiz: quizId, items: messages.length, statuses } }));
}

export async function consumeLockins(batch: MessageBatch<LockinMessage>, env: Env): Promise<void> {
	const valid: Array<Message<LockinMessage>> = [];
	for (const message of batch.messages) {
		if (isLockin(message.body)) valid.push(message);
		else {
			// Can't be saved: retried alone until it lands in the dead-letter queue, where it can be read
			console.error(JSON.stringify({ lockinMalformed: message.id }));
			message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
		}
	}
	await Promise.all(chunkByQuiz(valid).map(({ quizId, messages }) => saveChunk(env, quizId, messages)));
}
