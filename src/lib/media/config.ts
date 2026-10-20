/**
 * Supabase Storage media: bucket names, stored image sizes and URL helpers.
 *
 * Images are resized ONCE on upload (see image-processing.ts) into fixed WebP widths named
 * `<folder>/<id>-<width>.webp`; the database stores the URL of the largest one. The
 * next/image loader below then swaps in the smallest stored width that covers what the page
 * asks for, so the browser downloads a right-sized file straight from Supabase's CDN.
 * Nothing is transformed per request: no Supabase Image Transformations (billed beyond 100
 * origin images a month on Pro) and no Next.js optimizer work on the Hostinger server.
 *
 * Safe to import from client components (no server-only imports).
 */
import type { ImageLoader } from 'next/image';

export const MEDIA_BUCKETS = {
  site: 'site-media',
  prize: 'prize-images',
  avatar: 'avatars',
} as const;

export type MediaBucket = (typeof MEDIA_BUCKETS)[keyof typeof MEDIA_BUCKETS];

export interface ImagePreset {
  /** Stored widths, ascending. The last one is the canonical URL saved in the database. */
  widths: readonly number[];
  /** 'cover' crops to a square of each width; 'inside' keeps the aspect ratio. */
  fit: 'cover' | 'inside';
}

export const IMAGE_PRESETS: Record<MediaBucket, ImagePreset> = {
  // Banners, logos and other site images
  'site-media': { widths: [640, 1280, 1920], fit: 'inside' },
  // Prize cards are at most ~400px wide (800px on 2x screens); thumbnails 48-160px
  'prize-images': { widths: [320, 640, 1280], fit: 'inside' },
  // Avatars are drawn at 64-128px, so 256px covers 2x screens
  avatars: { widths: [256], fit: 'cover' },
};

/** What the admin upload route (/api/upload) accepts; the prize form checks the same before sending. */
export const UPLOAD_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
export const UPLOAD_IMAGE_TYPES_ERROR = 'Only JPEG, PNG, WebP, AVIF or GIF images can be uploaded';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_UPLOAD_ERROR = 'Image must be 10 MB or smaller';

/** Folders used inside the buckets. Avatars use the player's auth user id as the folder. */
export const MEDIA_FOLDERS = {
  siteUploads: 'uploads',
  prizes: 'prizes',
} as const;

const PUBLIC_PATH = '/storage/v1/object/public/';
const VARIANT = /^(.+)-(\d+)\.webp$/;

function supabaseOrigin(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
  } catch {
    return null;
  }
}

export function isMediaBucket(value: string): value is MediaBucket {
  return (Object.values(MEDIA_BUCKETS) as string[]).includes(value);
}

/** Public URL of an object in one of the media buckets. */
export function mediaPublicUrl(bucket: MediaBucket, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${supabaseOrigin() ?? ''}${PUBLIC_PATH}${bucket}/${encoded}`;
}

export interface MediaRef {
  bucket: MediaBucket;
  /** Object name inside the bucket, e.g. "prizes/abc-1280.webp" */
  path: string;
}

/**
 * Bucket + object name for a public URL of THIS project's media buckets; null for anything
 * else (other hosts, other buckets, Cloudinary), so callers can never touch a foreign file.
 */
export function parseMediaUrl(src: string | null | undefined): MediaRef | null {
  if (!src) return null;
  const origin = supabaseOrigin();
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (!origin || url.origin !== origin || !url.pathname.startsWith(PUBLIC_PATH)) return null;
  const rest = url.pathname.slice(PUBLIC_PATH.length).split('/');
  const bucket = rest.shift() as string;
  if (!isMediaBucket(bucket) || rest.length === 0) return null;
  let path: string;
  try {
    path = rest.map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  if (!path || path.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  return { bucket, path };
}

export function isMediaUrl(src: string | null | undefined): src is string {
  return parseMediaUrl(src) !== null;
}

/**
 * Every stored size of the image a URL points to (all variants share "<base>-"), or just that
 * one object when the name doesn't follow the variant pattern.
 */
export function mediaVariantPaths(ref: MediaRef): string[] {
  const match = VARIANT.exec(ref.path);
  if (!match) return [ref.path];
  return IMAGE_PRESETS[ref.bucket].widths.map((w) => `${match[1]}-${w}.webp`);
}

/**
 * Identity of an image regardless of which size a URL points at, e.g.
 * "prize-images/prizes/abc". Used to tell whether a prize still uses an image.
 */
export function mediaImageKey(ref: MediaRef): string {
  const match = VARIANT.exec(ref.path);
  return `${ref.bucket}/${match ? match[1] : ref.path}`;
}

/** next/image loader for media-bucket URLs: picks the smallest stored width >= `width`. */
export const mediaImageLoader: ImageLoader = ({ src, width }) => {
  const ref = parseMediaUrl(src);
  const match = ref && VARIANT.exec(ref.path);
  if (!ref || !match) return src;
  const widths = IMAGE_PRESETS[ref.bucket].widths;
  const chosen = widths.find((w) => w >= width) ?? widths[widths.length - 1];
  return mediaPublicUrl(ref.bucket, `${match[1]}-${chosen}.webp`);
};
