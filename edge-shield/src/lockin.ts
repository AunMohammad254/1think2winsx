/**
 * Lock-ins at the edge (LOCKIN_EDGE="true"). A burst of tens of thousands of lock-ins at a question's deadline
 * would trip Hostinger's site-wide block (~100 requests/s), so they never reach it: this Worker checks the
 * request and the session itself, stamps the time it received the lock-in, counts it (tally.ts) and puts it on
 * the `lockins` queue. The queue consumer (consumer.ts) saves batches through Supabase's submit_lockin_batch,
 * which judges each lock-in by that receive time, so the queue's delay never makes a player late.
 *
 * The player gets 202 "received" at once; the result of saving is the database's. Match overs send
 * `X-Lockin-Direct: 1` and still go to Hostinger, which answers with the saved result as today.
 */
import { busy, bytesToBase64Url, json } from './http';
import { JwksUnavailableError } from './jwt';
import { checkSession, sessionKey } from './session';
import { tallyFor } from './tally';

export const SUBMIT_PATH = /^\/api\/quizzes\/([^/]+)\/submit$/;
export const CSRF_PATH = '/api/csrf-token';

const UNANSWERED = -1; // src/lib/quiz-answers.ts
const MAX_ANSWERS = 200;
const MAX_BODY_BYTES = 64 * 1024; // 200 answers with 100-character ids are about 25 KB
const MAX_QUIZ_ID = 100;

const NOTE =
	'Your predictions have been received and are being saved. The admin will review all submissions and add correct answers. Points will be allocated to top performers based on accuracy.';

/** One queued lock-in: quiz, user, the edge's receive time (ISO), and the answers. */
export type LockinMessage = { q: string; u: string; t: string; a: Array<{ q: string; o: number }> };
type Answer = { questionId: string; selectedOption: number };
type Issue = { path: Array<string | number>; message: string };

/** Whether this request is a lock-in the edge takes (LOCKIN_EDGE on, POST submit, not a match over). */
export function isEdgeLockin(request: Request, env: Env, url: URL): boolean {
	return (
		env.LOCKIN_EDGE === 'true' &&
		request.method === 'POST' &&
		SUBMIT_PATH.test(url.pathname) &&
		request.headers.get('X-Lockin-Direct') !== '1'
	);
}

/**
 * The answers as the app's route reads them (submitQuizSchema in src/app/api/quizzes/[id]/submit/route.ts):
 * entries with selectedOption -1 (unanswered) are dropped first, then 1–200 answers of
 * { questionId: string of 1–100 characters, selectedOption: integer 0–9 }.
 */
export function readAnswers(body: unknown): { answers: Answer[] } | { error: string; details?: Issue[] } {
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		return { error: 'Invalid answers', details: [{ path: [], message: 'Expected an object' }] };
	}
	let sent = (body as { answers?: unknown }).answers;
	if (Array.isArray(sent)) {
		const answered = sent.filter((a) => (a as { selectedOption?: unknown } | null)?.selectedOption !== UNANSWERED);
		if (sent.length > 0 && answered.length === 0) return { error: 'Answer at least one question before submitting' };
		sent = answered;
	}
	if (!Array.isArray(sent)) return { error: 'Invalid answers', details: [{ path: ['answers'], message: 'Expected an array' }] };
	if (sent.length < 1 || sent.length > MAX_ANSWERS) {
		return { error: 'Invalid answers', details: [{ path: ['answers'], message: `Expected 1 to ${MAX_ANSWERS} answers` }] };
	}
	const details: Issue[] = [];
	sent.forEach((answer: unknown, i) => {
		if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
			details.push({ path: ['answers', i], message: 'Expected an object' });
			return;
		}
		const { questionId, selectedOption } = answer as Record<string, unknown>;
		if (typeof questionId !== 'string' || questionId.length < 1 || questionId.length > 100) {
			details.push({ path: ['answers', i, 'questionId'], message: 'Expected a string of 1 to 100 characters' });
		}
		if (typeof selectedOption !== 'number' || !Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption > 9) {
			details.push({ path: ['answers', i, 'selectedOption'], message: 'Expected an integer from 0 to 9' });
		}
	});
	if (details.length > 0) return { error: 'Invalid answers', details };
	return { answers: (sent as Answer[]).map(({ questionId, selectedOption }) => ({ questionId, selectedOption })) };
}

async function readBody(request: Request): Promise<{ body: unknown } | Response> {
	if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) return json({ error: 'Request body too large' }, 413);
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return json({ error: 'Request body too large' }, 413);
	try {
		return { body: JSON.parse(text) };
	} catch {
		return json({ error: 'Invalid JSON body' }, 400);
	}
}

/**
 * POST /api/quizzes/<id>/submit at the edge. Any fault answers busy (503, retried by the client) rather than
 * passing the lock-in on to Hostinger: at lock-in volume that would block the whole site.
 */
export async function handleLockin(request: Request, env: Env, url: URL): Promise<Response> {
	// Workers' clock reads the time this request arrived until it does I/O, so this is the receive time
	const receivedAt = new Date().toISOString();
	try {
		return await intake(request, env, url, receivedAt);
	} catch (error) {
		console.error(JSON.stringify({ lockinError: String(error), path: url.pathname }));
		return busy(503);
	}
}

async function intake(request: Request, env: Env, url: URL, receivedAt: string): Promise<Response> {
	if (request.headers.get('Origin') !== env.SITE_URL) return json({ error: 'Forbidden', code: 'forbidden' }, 403);

	let session;
	try {
		session = await checkSession(request, env.SUPABASE_URL);
	} catch (error) {
		if (error instanceof JwksUnavailableError) return busy(503);
		throw error;
	}
	if (!session.ok) {
		const expired = session.code === 'session_expired';
		return json({ error: expired ? 'Session expired, please retry' : 'Authentication required', code: session.code }, 401);
	}

	// The same per-session submit limit as before, with ENFORCE's log-only mode. The per-IP ceiling and Hostinger's
	// budget don't apply: the session is verified here, and nothing reaches Hostinger.
	const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
	if (!(await env.SUBMIT_LIMITER.limit({ key: await sessionKey(request, ip) })).success) {
		if (env.ENFORCE !== 'false') return busy(429);
		console.log(JSON.stringify({ wouldLimit: 'submit', method: request.method, path: url.pathname }));
	}

	let quizId: string;
	try {
		quizId = decodeURIComponent(SUBMIT_PATH.exec(url.pathname)![1]);
	} catch {
		return json({ error: 'Invalid quiz' }, 400);
	}
	if (quizId.length === 0 || quizId.length > MAX_QUIZ_ID) return json({ error: 'Invalid quiz' }, 400);

	const read = await readBody(request);
	if (read instanceof Response) return read;
	const parsed = readAnswers(read.body);
	if ('error' in parsed) return json(parsed, 400);

	const message: LockinMessage = {
		q: quizId,
		u: session.sub,
		t: receivedAt,
		a: parsed.answers.map(({ questionId, selectedOption }) => ({ q: questionId, o: selectedOption })),
	};

	// Counted before it is queued, so the tally is never below what the consumer will save
	const tally = tallyFor(env, quizId, session.sub);
	await tally.add(1);
	try {
		await env.LOCKIN_QUEUE.send(message, { contentType: 'json' });
	} catch (error) {
		console.error(JSON.stringify({ lockinQueueFailed: String(error), quiz: quizId }));
		try {
			await tally.add(-1);
		} catch (restoreError) {
			console.error(JSON.stringify({ lockinTallyRestoreFailed: String(restoreError), quiz: quizId }));
		}
		return busy(503);
	}

	return json(
		{
			message: 'Answer received',
			results: {
				attemptId: null,
				score: null,
				points: null,
				totalQuestions: null,
				submittedAnswers: message.a.length,
				status: 'received',
				isReattempt: null,
				note: NOTE,
			},
		},
		202,
	);
}

/** GET /api/csrf-token at the edge: the app checks tokens only by format (32+ base64url characters) and Origin. */
export function csrfToken(): Response {
	const csrfToken = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
	return json({ csrfToken, expiresAt: Date.now() + 60 * 60 * 1000 });
}
