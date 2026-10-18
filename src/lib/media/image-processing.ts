import sharp from 'sharp';
import type { ImagePreset } from './config';

/** Formats sharp may decode from an upload. Anything else (SVG, PDF, ...) is rejected. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff']);
/** Refuse decompression bombs: 40 megapixels is well above any phone photo. */
const MAX_INPUT_PIXELS = 40_000_000;
const WEBP_QUALITY = 80;

export class InvalidImageError extends Error {
  constructor(message = 'The file is not a supported image') {
    super(message);
    this.name = 'InvalidImageError';
  }
}

export interface ImageVariant {
  width: number;
  data: Buffer;
}

/**
 * Turns an uploaded image into the preset's WebP sizes, once, at upload time.
 * The real format is read from the bytes (the browser's MIME type is not trusted), the photo is
 * rotated upright from its EXIF orientation, metadata (EXIF/GPS) is dropped, and nothing is
 * enlarged. Animated GIFs keep their first frame.
 */
export async function toWebpVariants(input: Buffer, preset: ImagePreset): Promise<ImageVariant[]> {
  let format: string | undefined;
  try {
    ({ format } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata());
  } catch {
    throw new InvalidImageError();
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) throw new InvalidImageError();

  try {
    return await Promise.all(
      preset.widths.map(async (width) => {
        const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
        const resized = preset.fit === 'cover'
          ? image.resize(width, width, { fit: 'cover', position: sharp.strategy.attention })
          // Height capped at 2x the width so a very tall image can't produce a huge file
          : image.resize({ width, height: width * 2, fit: 'inside', withoutEnlargement: true });
        return { width, data: await resized.webp({ quality: WEBP_QUALITY }).toBuffer() };
      }),
    );
  } catch {
    // A valid header with corrupt pixel data fails here rather than in metadata()
    throw new InvalidImageError();
  }
}
