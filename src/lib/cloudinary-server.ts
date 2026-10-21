import { v2 as cloudinary } from 'cloudinary';
import { cloudinaryPublicIdFromUrl } from './cloudinary';

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// One to four path segments of letters, digits, - and _ (e.g. "prizes", "site/banners")
const FOLDER = /^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64}){0,3}$/;

/** True for a Cloudinary folder name an admin may upload into. */
export function isCloudinaryFolder(value: unknown): value is string {
  return typeof value === 'string' && FOLDER.test(value);
}

export interface CloudinaryUpload {
  publicId: string;
  url: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: string;
}

/** Uploads image bytes into `folder`, streamed rather than sent as a base64 string. */
export function uploadImageToCloudinary(image: Buffer, folder: string): Promise<CloudinaryUpload> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder, resource_type: 'image' }, (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary sent no upload result'));
          return;
        }
        resolve({
          publicId: result.public_id,
          url: result.secure_url,
          format: result.format,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          createdAt: result.created_at,
        });
      })
      .end(image);
  });
}

/**
 * Extracts the public ID from a Cloudinary URL of this account.
 * Example: https://res.cloudinary.com/dszrz6s6u/image/upload/t_1Think2win/f_auto/v1234567/uploads/abc1234.jpg
 * Returns: uploads/abc1234 (transformations and version stripped; null for other hosts/accounts)
 */
export function getPublicIdFromUrl(url: string): string | null {
  return cloudinaryPublicIdFromUrl(url);
}

/**
 * Deletes an image from Cloudinary by its URL
 */
export async function deleteCloudinaryImageByUrl(url: string): Promise<boolean> {
  try {
    const publicId = getPublicIdFromUrl(url);
    if (!publicId) return false;

    const result = await cloudinary.uploader.destroy(publicId);
    console.log(`Deleted Cloudinary image: ${publicId}`, result);
    return result.result === 'ok';
  } catch (error) {
    console.error('Failed to delete image from Cloudinary:', error);
    return false;
  }
}
