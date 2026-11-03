/**
 * Builds every logo file from the one brain illustration, public/images/brand/logo-1024.png.
 *
 *   bun scripts/generate-brand-assets.ts
 *
 * Two shapes come out of it:
 *  - the "mark": the neon ring and the brain cut out as a circle with a transparent outside. The site UI
 *    (src/components/brand/Logo.tsx), the browser-tab favicons, emails and the share card use it, because at
 *    16-48 px the square's dark margin would leave the brain a few pixels wide.
 *  - the full square with its dark background: phone home screens (apple-touch, PWA) and the link preview,
 *    where the platform rounds or masks the corners itself.
 *
 * The outputs are committed. Run this again only when the source image changes, then purge Cloudflare.
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const SOURCE = 'public/images/brand/logo-1024.png';
/** The neon ring and its glow, measured on the 1024 px source. */
const RING = { cx: 512, cy: 508, r: 404 };
/** The illustration's background colour, sampled from its corners. */
const BACKGROUND = '#020214';

/** UI sizes, read by the loader in src/components/brand/Logo.tsx (keep LOGO_WIDTHS in step). */
const UI_WIDTHS = [64, 128, 256, 512];

async function markMaster(): Promise<Buffer> {
    const d = RING.r * 2;
    // Soft 6 px edge so the cut through the outer glow doesn't look clipped
    const mask = Buffer.from(
        `<svg width="${d}" height="${d}"><defs><radialGradient id="g"><stop offset="98.5%" stop-color="#fff"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><circle cx="${RING.r}" cy="${RING.r}" r="${RING.r}" fill="url(#g)"/></svg>`
    );
    return sharp(SOURCE)
        .extract({ left: RING.cx - RING.r, top: RING.cy - RING.r, width: d, height: d })
        .ensureAlpha()
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

const markPng = (master: Buffer, size: number) => sharp(master).resize(size, size).png().toBuffer();
const squarePng = (size: number) => sharp(SOURCE).resize(size, size).png().toBuffer();

/** A .ico holding PNG images (every browser since IE 11 reads these). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
    const header = Buffer.alloc(6 + images.length * 16);
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(images.length, 4);
    let offset = header.length;
    images.forEach(({ size, png }, i) => {
        const entry = 6 + i * 16;
        header.writeUInt8(size % 256, entry); // 0 means 256
        header.writeUInt8(size % 256, entry + 1);
        header.writeUInt16LE(1, entry + 4); // colour planes
        header.writeUInt16LE(32, entry + 6); // bits per pixel
        header.writeUInt32LE(png.length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += png.length;
    });
    return Buffer.concat([header, ...images.map((image) => image.png)]);
}

/** 1200 x 630 link preview: the mark on the left, the wordmark and tagline on the right. */
async function ogImage(master: Buffer): Promise<Buffer> {
    const text = Buffer.from(`<svg width="660" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="t" x1="0" x2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="0.5" stop-color="#a78bfa"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs>
  <text x="0" y="285" font-family="Segoe UI, Arial, sans-serif" font-size="92" font-weight="700" fill="#ffffff">1Think <tspan fill="url(#t)">2Win</tspan></text>
  <text x="4" y="352" font-family="Segoe UI, Arial, sans-serif" font-size="34" fill="#cbd5e1">Think Smart, Win Big</text>
  <text x="4" y="408" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#94a3b8">Pakistan's sports quiz competition</text>
</svg>`);
    return sharp({ create: { width: 1200, height: 630, channels: 3, background: BACKGROUND } })
        .composite([
            { input: await markPng(master, 440), left: 70, top: 95 },
            { input: text, left: 560, top: 0 },
        ])
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
}

async function main() {
    const master = await markMaster();
    const favicon = ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await markPng(master, size) }))));

    const files: [string, Buffer][] = [
        ...(await Promise.all(
            UI_WIDTHS.map(async (w): Promise<[string, Buffer]> => [
                `public/images/brand/logo-${w}.webp`,
                await sharp(master).resize(w, w).webp({ quality: 90, alphaQuality: 100 }).toBuffer(),
            ])
        )),
        // Emails (Outlook has no WebP) and the share card (satori reads PNG)
        ['public/images/brand/logo-96.png', await markPng(master, 96)],
        ['public/Favicon/favicon-16x16.png', await markPng(master, 16)],
        ['public/Favicon/favicon-32x32.png', await markPng(master, 32)],
        ['public/Favicon/favicon.ico', favicon],
        ['src/app/favicon.ico', favicon],
        ['public/Favicon/apple-touch-icon.png', await squarePng(180)],
        ['public/Favicon/android-chrome-192x192.png', await squarePng(192)],
        ['public/Favicon/android-chrome-512x512.png', await squarePng(512)],
        ['public/og-image.jpg', await ogImage(master)],
    ];
    for (const [path, data] of files) {
        await writeFile(path, data);
        console.log(`${path}  ${(data.length / 1024).toFixed(1)} KB`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
