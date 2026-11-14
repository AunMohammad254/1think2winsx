import { getAdminDb } from '@/lib/supabase/db';

/**
 * Maintenance mode: while it is on, players get a "back soon" page (and the player APIs a 503), and
 * admins keep the whole site.
 *
 * Switched from the admin dashboard, stored in AppSettings under these keys. MAINTENANCE_MODE=true in
 * the environment forces it on without the database, for work during which the database is down.
 */
export const MAINTENANCE_KEYS = {
    enabled: 'maintenance_mode',
    message: 'maintenance_message',
    until: 'maintenance_until',
} as const;

export interface MaintenanceState {
    enabled: boolean;
    /** Shown to players; empty for the default text */
    message: string;
    /** ISO time the site should be back, or null when unknown */
    until: string | null;
}

export const MAINTENANCE_OFF: MaintenanceState = { enabled: false, message: '', until: null };

// Every page and API request asks, so the answer is kept briefly. Switching in the admin clears this
// process's copy at once; any other server process picks it up within this time.
const CACHE_TTL_MS = 10_000;
let cache: { state: MaintenanceState; fetchedAt: number } | null = null;
let inflight: Promise<MaintenanceState> | null = null;

/** Builds the state from AppSettings rows (missing rows mean off). */
export function stateFromRows(rows: { key: string; value: string }[]): MaintenanceState {
    const value = (key: string) => rows.find((r) => r.key === key)?.value ?? '';
    const until = value(MAINTENANCE_KEYS.until);
    return {
        enabled: value(MAINTENANCE_KEYS.enabled) === 'true',
        message: value(MAINTENANCE_KEYS.message),
        until: until && !Number.isNaN(Date.parse(until)) ? until : null,
    };
}

async function readFromDb(): Promise<MaintenanceState> {
    const { data, error } = await getAdminDb()
        .from('AppSettings')
        .select('key, value')
        .in('key', Object.values(MAINTENANCE_KEYS));
    if (error) throw error;
    const state = stateFromRows(data ?? []);
    cache = { state, fetchedAt: Date.now() };
    return state;
}

export async function getMaintenanceState(): Promise<MaintenanceState> {
    if (process.env.MAINTENANCE_MODE === 'true') {
        return { enabled: true, message: process.env.MAINTENANCE_MESSAGE ?? '', until: null };
    }
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.state;

    // Concurrent misses share one query
    inflight ??= readFromDb().finally(() => { inflight = null; });
    try {
        return await inflight;
    } catch (err) {
        // A database hiccup must not take the site down, nor reopen a site an admin closed:
        // keep the last answer, and only assume "off" when there has never been one
        console.error('[maintenance] Could not read the maintenance flag:', err);
        return cache?.state ?? MAINTENANCE_OFF;
    }
}

/** Forget the cached flag: call after an admin switches it. */
export function invalidateMaintenanceCache(): void {
    cache = null;
}

/** Seconds a client should wait before trying again (Retry-After): until the end time, else 5 minutes. */
export function retryAfterSeconds(until: string | null, now = Date.now()): number {
    const seconds = until ? Math.ceil((Date.parse(until) - now) / 1000) : 0;
    return seconds > 0 ? seconds : 300;
}

/**
 * Pages and APIs that keep working during maintenance for everyone, admin cookie or not: the admin
 * area (and its login), scheduled jobs, incoming webhooks and the email hook, the health check, the
 * CSRF token the admin forms need, and the Sentry tunnel.
 */
const OPEN_PREFIXES = [
    '/admin',
    '/api/admin',
    '/api/cron',
    '/api/webhooks',
    '/api/auth/send-email-hook',
    '/api/health',
    '/api/csrf-token',
    '/monitoring',
];

export function isOpenDuringMaintenance(pathname: string): boolean {
    return OPEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The page players see. Plain HTML with its own styles, so it works even when the app itself cannot
 * render, and it reloads itself every minute to come back as soon as maintenance ends.
 */
export function maintenancePageHtml(state: MaintenanceState): string {
    const message = escapeHtml(
        state.message.trim() ||
            "We're making some improvements to 1Think 2Win. We'll be back shortly. Thanks for your patience!"
    );
    // Formatted in the browser, in the visitor's own time zone
    const until = state.until
        ? `<p class="until">Expected back by <time datetime="${escapeHtml(state.until)}">${escapeHtml(state.until)}</time></p>
<script>(function(){var t=document.querySelector('time');var d=new Date(t.getAttribute('datetime'));if(!isNaN(d))t.textContent=d.toLocaleString([], {dateStyle:'medium',timeStyle:'short'});})();</script>`
        : '';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="60">
<title>Down for maintenance | 1Think 2Win</title>
<link rel="icon" href="/Favicon/favicon-32x32.png">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e5e7eb;
background:linear-gradient(135deg,#1e3a8a 0%,#1f2937 50%,#000 100%)}
.card{max-width:28rem;width:100%;text-align:center;padding:2.5rem 2rem;border-radius:1.5rem;
background:linear-gradient(135deg,rgba(17,24,39,.92),rgba(31,41,55,.85));border:1px solid rgba(255,255,255,.1);
box-shadow:0 25px 50px -12px rgba(0,0,0,.6)}
.logo{width:72px;height:72px;border-radius:1rem;margin:0 auto 1.5rem;display:block}
h1{margin:0 0 .75rem;font-size:1.6rem;color:#fff}
.grad{background:linear-gradient(90deg,#c084fc,#60a5fa);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin:0 0 1rem;line-height:1.6;color:#9ca3af}
.until{color:#c4b5fd;font-weight:600}
.small{font-size:.8rem;color:#6b7280;margin:1.5rem 0 0}
</style>
</head>
<body>
<main class="card">
<img class="logo" src="/Favicon/apple-touch-icon.png" alt="1Think 2Win">
<h1><span class="grad">Down for maintenance</span></h1>
<p>${message}</p>
${until}
<p class="small">This page refreshes by itself every minute.</p>
</main>
</body>
</html>`;
}

/** Test hook: forget all module state. */
export function __resetMaintenanceStateForTests(): void {
    cache = null;
    inflight = null;
}
