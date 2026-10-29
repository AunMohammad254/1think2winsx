/**
 * Edge shield for the 1Think2Win API (routed on /api/* only).
 *
 * The origin is a single Node process on Hostinger, which blocks the whole site (HTTP 403, about 19 minutes)
 * once roughly 100 requests per second reach it. So bursts (quiz start, mass submit) must be absorbed here:
 *  - rate limits at the edge, so excess requests never reach Node: per caller, a per-IP ceiling, and an
 *    origin budget per Cloudflare location that keeps the API's share of Hostinger's traffic under its limit;
 *  - a time-to-headers timeout on origin calls;
 *  - busy responses shaped like the app's withLoadShed (src/lib/load-shed.ts), which the client's
 *    fetch-retry helper already retries with Retry-After; Hostinger's 403 block page becomes one too.
 * It also runs the app's scheduler on a Cron Trigger.
 *
 * ENFORCE=false is log-only: limits are counted and logged ("wouldLimit"), never applied, so the first days
 * on real traffic show where the limits sit. Paths Cloudflare serves from its cache, and the webhooks, have
 * routes without this Worker (see README.md), so they cost no Worker requests and meet no limit here.
 */

const ORIGIN_TIMEOUT_MS = 15_000;
const SUBMIT_PATH = /^\/api\/quizzes\/[^/]+\/submit$/;
// Never limited: the scheduler, and senders that sign their own calls and burst from a few IPs (Brevo, SES, Supabase)
const UNLIMITED_PATH = /^\/api\/(cron|webhooks)\/|^\/api\/auth\/send-email-hook$/;
// May take longer than ORIGIN_TIMEOUT_MS: admin work (sends, settlement), the scheduler, uploads from slow phones
const SLOW_PATH = /^\/api\/(admin|cron)\/|^\/api\/(upload|profile\/upload-picture)$/;

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// A fault in this Worker must never take the API down: on an exception the request goes on to Hostinger
		ctx.passThroughOnException();
		const url = new URL(request.url);
		const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

		if (!UNLIMITED_PATH.test(url.pathname)) {
			// Per caller, plus a high per-IP ceiling: mobile carriers put many players behind one IP,
			// and the ceiling still bounds a client that rotates fake session cookies.
			const isSubmit = request.method === 'POST' && SUBMIT_PATH.test(url.pathname);
			const limiter = isSubmit ? env.SUBMIT_LIMITER : env.API_LIMITER;
			const [perCaller, perIp] = await Promise.all([
				limiter.limit({ key: await sessionKey(request, ip) }),
				env.IP_LIMITER.limit({ key: ip }),
			]);
			let over = !perCaller.success ? (isSubmit ? 'submit' : 'api') : !perIp.success ? 'ip' : null;
			// Only requests that would reach Hostinger count against its budget
			if (!over && !(await env.ORIGIN_LIMITER.limit({ key: 'origin' })).success) over = 'origin';
			if (over) {
				if (env.ENFORCE !== 'false') return busy(over === 'origin' ? 503 : 429);
				console.log(JSON.stringify({ wouldLimit: over, method: request.method, path: url.pathname }));
			}
		}

		const response = await toOrigin(request, SLOW_PATH.test(url.pathname) ? undefined : ORIGIN_TIMEOUT_MS);
		// Hostinger's own limit answers every path with an HTML 403 page; the app's 403s are JSON
		if (response.status === 403 && (response.headers.get('content-type') ?? '').startsWith('text/html')) {
			console.error(JSON.stringify({ hostingerBlock: true, method: request.method, path: url.pathname }));
			return busy(503);
		}
		return response;
	},

	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(
			fetch(`${env.SITE_URL}/api/cron/process-scheduled`, {
				headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
			}).then((response) => {
				// Shows up in Workers Logs, e.g. a 401 when CRON_SECRET differs from the app's
				if (!response.ok) console.error(`process-scheduled answered ${response.status}`);
			}),
		);
	},
} satisfies ExportedHandler<Env>;

/** The request at Hostinger, or a busy 503 when it fails or sends no headers within `timeoutMs`. */
async function toOrigin(request: Request, timeoutMs?: number): Promise<Response> {
	const controller = new AbortController();
	const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(request, { signal: controller.signal });
	} catch {
		return busy(503);
	} finally {
		if (timer !== undefined) clearTimeout(timer); // bounds time-to-headers only, so streamed bodies aren't cut off
	}
}

// Key by session so users behind one carrier NAT don't share a bucket.
// The cookie is not verified here; the origin still authenticates every request.
async function sessionKey(request: Request, ip: string): Promise<string> {
	const match = /sb-[^=]+-auth-token(?:\.0)?=([^;]+)/.exec(request.headers.get('Cookie') ?? '');
	if (!match) return `ip:${ip}`;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1]));
	return 's:' + [...new Uint8Array(digest, 0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Same body and jittered Retry-After as the app's withLoadShed, so existing client retries apply
function busy(status: 429 | 503): Response {
	const retryAfter = 1 + Math.floor(Math.random() * 6);
	return Response.json(
		{ error: 'Server is busy, please retry shortly', code: 'OVERLOADED', retryAfter },
		{ status, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } },
	);
}
