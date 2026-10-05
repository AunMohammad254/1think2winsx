/**
 * Public site URL without a trailing slash. A trailing slash in NEXT_PUBLIC_SITE_URL used to produce
 * links such as "https://example.com//auth/callback".
 */
export function siteUrl(): string {
    return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}
