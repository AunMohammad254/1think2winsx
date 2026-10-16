import { v2 as cloudinary } from 'cloudinary';
import { cloudinaryPublicIdFromUrl } from './cloudinary';

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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
