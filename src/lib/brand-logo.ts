import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The brain mark at 96 px, under public/ (scripts/generate-brand-assets.ts makes it). Emails link to it too. */
export const BRAND_LOGO_PNG = '/images/brand/logo-96.png';

/**
 * The brain mark as a data URI, for server-drawn images (satori can't fetch a relative URL).
 * Null when the file can't be read: a share card without its logo beats no card.
 */
export async function brandLogoDataUri(): Promise<string | null> {
    try {
        const png = await readFile(join(process.cwd(), 'public', BRAND_LOGO_PNG));
        return `data:image/png;base64,${png.toString('base64')}`;
    } catch (err) {
        console.error('[Brand logo] Not readable, drawing without it:', err);
        return null;
    }
}
