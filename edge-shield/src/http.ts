// Same body and jittered Retry-After as the app's withLoadShed, so existing client retries apply
export function busy(status: 429 | 503): Response {
	const retryAfter = 1 + Math.floor(Math.random() * 6);
	return Response.json(
		{ error: 'Server is busy, please retry shortly', code: 'OVERLOADED', retryAfter },
		{ status, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } },
	);
}

/** A JSON answer the Worker gives itself; never cached. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Throws on characters outside the base64url alphabet. */
export function base64UrlToBytes(text: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
	const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Compares two secrets without leaking where they differ through timing. */
export function sameSecret(given: string, expected: string): boolean {
	const encoder = new TextEncoder();
	const a = encoder.encode(given);
	const b = encoder.encode(expected);
	if (a.byteLength !== b.byteLength) return false;
	return crypto.subtle.timingSafeEqual(a, b);
}
