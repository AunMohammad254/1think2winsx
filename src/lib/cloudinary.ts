/**
 * Cloudinary helpers for images and videos.
 *
 * Images are resized by Cloudinary (not the Next.js optimizer): the loader adds
 * `w_<width>,c_limit,q_auto,f_auto` after any transformations already in the URL
 * (e.g. the `t_1Think2win` named transformation), so each <Image> gets a right-sized
 * WebP/AVIF straight from Cloudinary's CDN.
 */
import type { ImageLoader } from 'next/image';

export const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dszrz6s6u';

// Leading parameter of a Cloudinary transformation component (w_400, t_name, c_fill, $var_...)
// (real parameter names only, so folders such as "my_prizes/" aren't mistaken for one)
const TRANSFORM_KEY = /^(?:a|ac|af|ar|b|bo|br|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|if|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z|\$[a-z0-9]+)_/;

function parse(src: string): URL | null {
  try {
    return new URL(src);
  } catch {
    return null;
  }
}

/** True for delivery URLs of this project's Cloudinary account. */
export function isCloudinaryUrl(src: string | null | undefined): src is string {
  if (!src) return false;
  const url = parse(src);
  return !!url && url.protocol === 'https:' && url.hostname === 'res.cloudinary.com'
    && url.pathname.startsWith(`/${CLOUDINARY_CLOUD_NAME}/`);
}

function isTransformSegment(segment: string): boolean {
  return segment.split(',').every((part) => TRANSFORM_KEY.test(part));
}

/** next/image loader for Cloudinary URLs; other URLs are returned unchanged. */
export const cloudinaryLoader: ImageLoader = ({ src, width, quality }) => {
  const url = parse(src);
  const marker = '/upload/';
  const at = url ? url.pathname.indexOf(marker) : -1;
  if (!url || at === -1) return src;

  const head = url.pathname.slice(0, at + marker.length);
  const segments = url.pathname.slice(at + marker.length).split('/');
  // Keep existing transformations first, then add sizing, then version + public id
  let i = 0;
  while (i < segments.length - 1 && !/^v\d+$/.test(segments[i]) && isTransformSegment(segments[i])) i++;
  const sizing = `w_${width},c_limit,q_${quality ?? 'auto'},f_auto`;
  
  const existingTransforms = segments.slice(0, i);
  const template = 't_1Think2win';
  const hasTemplate = existingTransforms.some(t => t.split(',').includes(template));
  
  url.pathname = head + [...existingTransforms, ...(hasTemplate ? [] : [template]), sizing, ...segments.slice(i)].join('/');
  return url.toString();
};

/** Per-image loader prop: Cloudinary resizing for Cloudinary URLs, Next's default otherwise. */
export function loaderFor(src: string | null | undefined): ImageLoader | undefined {
  return isCloudinaryUrl(src) ? cloudinaryLoader : undefined;
}

/**
 * Hosts prize images may come from. next/image throws for hosts missing from
 * next.config.js `images.remotePatterns`, so saving any other host would break prize pages.
 */
export function isAllowedPrizeImageUrl(src: string): boolean {
  if (src.startsWith('/') && !src.startsWith('//')) return true; // local /public files
  // Legacy prizes store small images inline; keep them editable until moved to Cloudinary
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/.test(src)) return true;
  if (isCloudinaryUrl(src)) return true;
  const url = parse(src);
  if (!url || url.protocol !== 'https:') return false;
  return url.hostname === 'lh3.googleusercontent.com' || url.hostname.endsWith('.pakwheels.com');
}

export const PRIZE_IMAGE_URL_HINT =
  `Use a Cloudinary link from res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/…`;
