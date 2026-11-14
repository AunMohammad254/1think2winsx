/**
 * Plain-language explanations for the problems a visitor can fix themselves: no internet, a wrong
 * device clock, a blocked security check, or an old copy of the site after a deploy.
 */

/** Further than this from the real time, Cloudflare's security check refuses to finish. */
export const CLOCK_SKEW_LIMIT_MS = 5 * 60_000;

/**
 * How far this device's clock is from the real time, in ms: positive when the device is BEHIND.
 * Reads the Date header of a small file on our own site (Cloudflare stamps it with the current time
 * even on a cache hit). Null when the request fails or the header is missing.
 */
export async function measureClockSkew(url = '/favicon.ico'): Promise<number | null> {
    try {
        const sentAt = Date.now();
        const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        const server = Date.parse(res.headers.get('date') ?? '');
        if (Number.isNaN(server)) return null;
        // The header was written somewhere between sending and receiving: take the midpoint
        return server - (sentAt + Date.now()) / 2;
    } catch {
        return null;
    }
}

/** "about 12 hours behind", "about 7 minutes ahead" */
export function describeClockSkew(skewMs: number): string {
    const minutes = Math.round(Math.abs(skewMs) / 60_000);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);
    const amount =
        days >= 2 ? `${days} days` :
        minutes >= 90 ? `${hours} hours` :
        minutes >= 60 ? 'an hour' :
        minutes === 1 ? '1 minute' :
        `${minutes} minutes`;
    return `about ${amount} ${skewMs > 0 ? 'behind' : 'ahead'}`;
}

export type TurnstileProblem = 'offline' | 'clock' | 'blocked' | 'config' | 'timeout' | 'challenge' | 'unknown';

/**
 * Sorts a Turnstile error code into something the visitor can act on.
 * Codes: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
 */
export function turnstileProblem(code: string | undefined): TurnstileProblem {
    const c = code ?? '';
    if (c === '200100') return 'clock'; // "Clock or cache problem"
    if (c === '110600' || c === '110620') return 'timeout';
    if (c === '200500') return 'blocked'; // the challenge iframe could not load
    // Bad, unknown, disabled or wrong-domain site key: our setup, not the visitor's
    if (/^(1101|1102|4000)\d\d$/.test(c)) return 'config';
    if (/^[36]\d{5}$/.test(c)) return 'challenge';
    return 'unknown';
}

export function turnstileMessage(problem: TurnstileProblem, skewMs: number | null = null): string {
    switch (problem) {
        case 'offline':
            return "You're offline. Check your Wi-Fi or mobile data. The check restarts by itself when you're back online.";
        case 'clock':
            return `Your device's date or time is wrong${skewMs === null ? '' : ` (${describeClockSkew(skewMs)})`}. ` +
                'Turn on "Set time automatically" in your device settings, then tap Try again.';
        case 'blocked':
            return "The security check couldn't load. An ad blocker, VPN or firewall may be blocking challenges.cloudflare.com. Allow it, then tap Try again.";
        case 'config':
            return "The security check isn't working on our side right now. Please try again in a few minutes or contact support.";
        case 'timeout':
            return 'The security check timed out. Tap Try again to restart it.';
        case 'challenge':
            return "We couldn't verify your browser. Turn off any VPN or browser extensions, or try another browser, then tap Try again.";
        case 'unknown':
            return "The security check couldn't finish. Check your connection or ad blocker, then tap Try again.";
    }
}

export type PageErrorKind = 'offline' | 'update' | 'generic';

/**
 * Why a page crashed, as far as the visitor is concerned. "update" is a file from an older deploy
 * that no longer exists on the server: only a full reload fixes it.
 */
export function classifyPageError(error: unknown, online: boolean): PageErrorKind {
    if (!online) return 'offline';
    const e = (typeof error === 'object' && error !== null ? error : {}) as { name?: unknown; message?: unknown };
    const text = `${String(e.name ?? '')} ${String(e.message ?? '')}`;
    if (/ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed/i.test(text)) {
        return 'update';
    }
    return 'generic';
}

/** For a request that threw: says so plainly when the device is offline, else keeps `fallback`. */
export function networkAwareMessage(fallback: string): string {
    return navigator.onLine ? fallback : "You're offline. Check your internet connection and try again.";
}
