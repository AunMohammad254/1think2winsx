'use client';

/**
 * CSRF Client Utility
 * Provides helpers for fetching and managing CSRF tokens in the frontend
 */

// The server issues a random token with a 1 h expiry and validates it by format + Origin check
// (see /api/csrf-token and csrf-protection.ts). It is not bound to a request, so one token can
// safely serve every mutation until it nears expiry. Fetching a fresh one before EVERY
// mutation doubled the request count of every submit/mark-read/etc. — painful when 50k
// players submit within seconds.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 30 * 60 * 1000;

let cachedToken: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

async function fetchToken(): Promise<string | null> {
    try {
        const response = await fetch('/api/csrf-token');
        if (!response.ok) throw new Error('Failed to fetch CSRF token');
        const data = await response.json();
        if (!data?.csrfToken) return null;
        const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : Date.now() + FALLBACK_TTL_MS;
        cachedToken = { value: data.csrfToken, expiresAt };
        return data.csrfToken;
    } catch (error) {
        console.error('Error fetching CSRF token:', error);
        return null;
    }
}

/**
 * Returns a CSRF token, reusing the cached one until shortly before it expires.
 * Use this before making any mutating requests (POST, PUT, DELETE, PATCH)
 */
export async function getCSRFToken(): Promise<string | null> {
    if (cachedToken && cachedToken.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
        return cachedToken.value;
    }
    // Concurrent callers (e.g. several mutations at once) share one request
    if (!inflight) {
        inflight = fetchToken().finally(() => { inflight = null; });
    }
    return inflight;
}

/** Drop the cached token (e.g. after a 403 that blames the token). */
export function clearCSRFTokenCache(): void {
    cachedToken = null;
}

/**
 * Helper to include CSRF token in fetch headers
 */
export async function getCSRFHeaders(): Promise<Record<string, string>> {
    const token = await getCSRFToken();
    return token ? { 'x-csrf-token': token } : {};
}
