/**
 * Purges Cloudflare's whole cache for the zone, so the public pages it keeps (see
 * deploy/CLOUDFLARE_PAGE_CACHE.md) are fetched from Hostinger again.
 *
 * Needs CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN (a token with only Zone > Cache Purge > Purge).
 * Without them it reports "skipped" and changes nothing.
 */
export type PurgeResult = 'purged' | 'skipped' | 'failed';

export async function purgeCloudflareCache(env: Record<string, string | undefined> = process.env): Promise<PurgeResult> {
    const zoneId = env.CLOUDFLARE_ZONE_ID?.trim();
    const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
    if (!zoneId || !apiToken) return 'skipped';

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({ purge_everything: true }),
            signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
        if (res.ok && body?.success) return 'purged';
        console.error('[cloudflare-purge] Purge refused:', res.status, JSON.stringify(body));
        return 'failed';
    } catch (err) {
        console.error('[cloudflare-purge] Purge request failed:', err);
        return 'failed';
    }
}
