/**
 * Edge shield for the 1Think2Win API (routed on /api/* only).
 *
 * The origin is a single Node process, so bursts (quiz start, mass submit) must be absorbed here:
 *  - rate limits at the edge, so excess requests never reach Node;
 *  - edge cache for shared, user-independent GETs (cookies stripped so nothing per-user is cached);
 *  - a time-to-headers timeout on origin calls;
 *  - busy responses shaped like the app's withLoadShed (src/lib/load-shed.ts), which the client's
 *    fetch-retry helper already retries with Retry-After.
 * It also runs the app's scheduler on a Cron Trigger.
 */

// Public, user-independent GETs and their edge TTL in seconds
const EDGE_CACHE: Record<string, number> = {
	'/api/leaderboard': 30,
};

const ORIGIN_TIMEOUT_MS = 15_000;
const SUBMIT_PATH = /^\/api\/quizzes\/[^/]+\/submit$/;

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

		if (!url.pathname.startsWith('/api/cron/')) {
			// Per caller, plus a high per-IP ceiling: mobile carriers put many players behind one IP,
			// and the ceiling still bounds a client that rotates fake session cookies.
			const isSubmit = request.method === 'POST' && SUBMIT_PATH.test(url.pathname);
			const limiter = isSubmit ? env.SUBMIT_LIMITER : env.API_LIMITER;
			const [perCaller, perIp] = await Promise.all([
				limiter.limit({ key: await sessionKey(request, ip) }),
				env.IP_LIMITER.limit({ key: ip }),
			]);
			if (!perCaller.success || !perIp.success) return busy(429);
		}

		const ttl = EDGE_CACHE[url.pathname];
		if (request.method === 'GET' && ttl) {
			const headers = new Headers(request.headers);
			headers.delete('Cookie'); // a session must never reach a cached response
			return toOrigin(new Request(request, { headers }), {
				cacheEverything: true,
				cacheTtlByStatus: { '200-299': ttl, '404': 5, '500-599': 0 },
			});
		}

		return toOrigin(request);
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

async function toOrigin(request: Request, cf?: RequestInitCfProperties): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ORIGIN_TIMEOUT_MS);
	try {
		return await fetch(request, { cf, signal: controller.signal });
	} catch {
		return busy(503);
	} finally {
		clearTimeout(timer); // bounds time-to-headers only, so streamed bodies aren't cut off
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
