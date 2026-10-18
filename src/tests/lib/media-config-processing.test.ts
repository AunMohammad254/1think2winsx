// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import {
  IMAGE_PRESETS,
  isMediaBucket,
  isMediaUrl,
  mediaImageKey,
  mediaImageLoader,
  mediaPublicUrl,
  mediaVariantPaths,
  parseMediaUrl,
} from '@/lib/media/config';
import { InvalidImageError, toWebpVariants } from '@/lib/media/image-processing';
import { isAllowedPrizeImageUrl, loaderFor, cloudinaryLoader } from '@/lib/cloudinary';

const ORIGIN = 'https://proj.supabase.co';
const PUB = `${ORIGIN}/storage/v1/object/public`;

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `${ORIGIN}/`));
afterEach(() => vi.unstubAllEnvs());

describe('media URLs', () => {
  it('builds public URLs, encoding each path segment', () => {
    expect(mediaPublicUrl('prize-images', 'prizes/a b-1280.webp')).toBe(`${PUB}/prize-images/prizes/a%20b-1280.webp`);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(mediaPublicUrl('avatars', 'u/x-256.webp')).toBe('/storage/v1/object/public/avatars/u/x-256.webp');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', undefined);
    expect(parseMediaUrl(`${PUB}/avatars/u/x-256.webp`)).toBeNull();
  });

  it('parses only this project\'s media buckets', () => {
    expect(parseMediaUrl(`${PUB}/prize-images/prizes/a%20b-1280.webp`)).toEqual({ bucket: 'prize-images', path: 'prizes/a b-1280.webp' });
    expect(parseMediaUrl(`${PUB}/avatars/user-1/x-256.webp`)).toEqual({ bucket: 'avatars', path: 'user-1/x-256.webp' });
    for (const bad of [
      null,
      undefined,
      '',
      'not a url',
      'https://other.supabase.co/storage/v1/object/public/avatars/u/x-256.webp', // another project
      `${ORIGIN}/storage/v1/object/sign/avatars/u/x-256.webp`, // not a public URL
      `${PUB}/receipts/u/x.png`, // not a media bucket
      `${PUB}/avatars`, // no object
      `${PUB}/`, // no bucket
      `${PUB}/avatars/u/%E0%A4%A.webp`, // broken escape
      `${PUB}/avatars/u//x.webp`, // empty segment
      `${PUB}/avatars/u%2F..%2Fother%2Fx.webp`, // .. hidden in an encoded slash
    ]) {
      expect(parseMediaUrl(bad)).toBeNull();
    }
    // Dot segments are resolved by URL parsing itself, so the result is the object really served
    expect(parseMediaUrl(`${PUB}/avatars/u/../v/x-256.webp`)).toEqual({ bucket: 'avatars', path: 'v/x-256.webp' });
    expect(isMediaUrl(`${PUB}/site-media/uploads/a-1920.webp`)).toBe(true);
    expect(isMediaUrl('https://res.cloudinary.com/dszrz6s6u/image/upload/a.jpg')).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'not a url');
    expect(parseMediaUrl(`${PUB}/avatars/u/x-256.webp`)).toBeNull();
  });

  it('knows its buckets', () => {
    expect(isMediaBucket('avatars')).toBe(true);
    expect(isMediaBucket('uploads')).toBe(false);
  });

  it('lists every stored size of an image and gives it one identity', () => {
    const ref = { bucket: 'prize-images' as const, path: 'prizes/abc-640.webp' };
    expect(mediaVariantPaths(ref)).toEqual(['prizes/abc-320.webp', 'prizes/abc-640.webp', 'prizes/abc-1280.webp']);
    expect(mediaImageKey(ref)).toBe('prize-images/prizes/abc');
    expect(mediaImageKey({ bucket: 'prize-images', path: 'prizes/abc-1280.webp' })).toBe('prize-images/prizes/abc');
    const odd = { bucket: 'site-media' as const, path: 'assets/logo.png' };
    expect(mediaVariantPaths(odd)).toEqual(['assets/logo.png']);
    expect(mediaImageKey(odd)).toBe('site-media/assets/logo.png');
  });

  it('loader serves the smallest stored size that covers the requested width', () => {
    const src = `${PUB}/prize-images/prizes/abc-1280.webp`;
    expect(mediaImageLoader({ src, width: 48 })).toBe(`${PUB}/prize-images/prizes/abc-320.webp`);
    expect(mediaImageLoader({ src, width: 320 })).toBe(`${PUB}/prize-images/prizes/abc-320.webp`);
    expect(mediaImageLoader({ src, width: 640 })).toBe(`${PUB}/prize-images/prizes/abc-640.webp`);
    expect(mediaImageLoader({ src, width: 3840 })).toBe(src);
    expect(mediaImageLoader({ src: `${PUB}/avatars/u/x-256.webp`, width: 16 })).toBe(`${PUB}/avatars/u/x-256.webp`);
    // Anything else is passed through untouched
    expect(mediaImageLoader({ src: `${PUB}/site-media/assets/logo.png`, width: 64 })).toBe(`${PUB}/site-media/assets/logo.png`);
    expect(mediaImageLoader({ src: '/local.png', width: 64 })).toBe('/local.png');
  });
});

describe('cloudinary.ts with Supabase media', () => {
  it('picks the right loader per URL', () => {
    expect(loaderFor(`${PUB}/prize-images/prizes/abc-1280.webp`)).toBe(mediaImageLoader);
    expect(loaderFor('https://res.cloudinary.com/dszrz6s6u/image/upload/a.jpg')).toBe(cloudinaryLoader);
    expect(loaderFor('/local.png')).toBeUndefined();
    expect(loaderFor(null)).toBeUndefined();
  });

  it('allows admin media buckets for prize images, never players\' avatars', () => {
    expect(isAllowedPrizeImageUrl(`${PUB}/prize-images/prizes/abc-1280.webp`)).toBe(true);
    expect(isAllowedPrizeImageUrl(`${PUB}/site-media/uploads/abc-1920.webp`)).toBe(true);
    expect(isAllowedPrizeImageUrl(`${PUB}/avatars/user-1/abc-256.webp`)).toBe(false);
    expect(isAllowedPrizeImageUrl('https://evil.example/x.png')).toBe(false);
  });
});

describe('toWebpVariants (real sharp)', () => {
  const png = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();

  it('stores each prize width as WebP, never enlarging, with tall images capped at 2x the width', async () => {
    const variants = await toWebpVariants(await png(1000, 500), IMAGE_PRESETS['prize-images']);
    expect(variants.map((v) => v.width)).toEqual([320, 640, 1280]);
    const meta = await Promise.all(variants.map((v) => sharp(v.data).metadata()));
    expect(meta.map((m) => m.format)).toEqual(['webp', 'webp', 'webp']);
    expect(meta.map((m) => [m.width, m.height])).toEqual([[320, 160], [640, 320], [1000, 500]]);

    const [tall] = await toWebpVariants(await png(400, 4000), { widths: [320], fit: 'inside' });
    const tallMeta = await sharp(tall.data).metadata();
    expect([tallMeta.width, tallMeta.height]).toEqual([64, 640]);
  });

  it('crops avatars to a square and drops metadata', async () => {
    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3a6' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } })
      .toBuffer();
    const [avatar] = await toWebpVariants(jpeg, IMAGE_PRESETS.avatars);
    const meta = await sharp(avatar.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 256, 256]);
    expect(meta.exif).toBeUndefined();
  });

  it('rejects files that are not supported images', async () => {
    await expect(toWebpVariants(Buffer.from('<html>not an image</html>'), IMAGE_PRESETS.avatars)).rejects.toBeInstanceOf(InvalidImageError);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await expect(toWebpVariants(svg, IMAGE_PRESETS.avatars)).rejects.toThrow('The file is not a supported image');
    // A broken header fails at metadata()...
    await expect(toWebpVariants((await png(50, 50)).subarray(0, 60), IMAGE_PRESETS.avatars)).rejects.toBeInstanceOf(InvalidImageError);
    // ...a PNG cut off halfway passes metadata() but fails while decoding the pixels
    const noisy = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000', noise: { type: 'gaussian', mean: 128, sigma: 30 } } }).png().toBuffer();
    const halfFile = noisy.subarray(0, Math.floor(noisy.length / 2));
    await expect(sharp(halfFile).metadata()).resolves.toMatchObject({ format: 'png' });
    await expect(toWebpVariants(halfFile, IMAGE_PRESETS.avatars)).rejects.toBeInstanceOf(InvalidImageError);
  });
});
