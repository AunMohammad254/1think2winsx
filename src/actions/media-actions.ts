'use server';

import { v2 as cloudinary } from 'cloudinary';
import { requireAdminSession } from '@/lib/admin-session';
import { getAdminDb } from '@/lib/supabase/db';
import { storeImage } from '@/lib/media/storage.server';
import { listMediaImages } from '@/actions/supabase-media-actions';

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function getCloudinaryUsage() {
  await requireAdminSession();
  
  try {
    const usage = await cloudinary.api.usage();
    return { success: true, usage };
  } catch (error: any) {
    console.error('Failed to get Cloudinary usage:', error);
    return { success: false, error: error.message };
  }
}

export async function getCloudinaryResources(cursor?: string) {
  await requireAdminSession();
  
  try {
    const options: any = {
      max_results: 100,
      type: 'upload',
    };
    if (cursor) options.next_cursor = cursor;

    const resources = await cloudinary.api.resources(options);
    return { success: true, resources };
  } catch (error: any) {
    console.error('Failed to get Cloudinary resources:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteCloudinaryResource(publicId: string) {
  await requireAdminSession();
  
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return { success: true, result };
  } catch (error: any) {
    console.error('Failed to delete Cloudinary resource:', error);
    return { success: false, error: error.message };
  }
}

/** Bulk delete multiple assets from Cloudinary in a single API call */
export async function bulkDeleteCloudinaryResources(publicIds: string[]) {
  await requireAdminSession();

  try {
    if (!publicIds || publicIds.length === 0) {
      return { success: false, error: 'No resources provided' };
    }

    const result = await cloudinary.api.delete_resources(publicIds);
    return { success: true, result };
  } catch (error: any) {
    console.error('Failed to bulk delete Cloudinary resources:', error);
    return { success: false, error: error.message || 'Bulk delete failed' };
  }
}

/** Direct upload of an image file to Cloudinary */
export async function uploadToCloudinary(formData: FormData) {
  await requireAdminSession();

  try {
    const file = formData.get('file') as File | null;
    const folder = (formData.get('folder') as string) || 'uploads';

    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || 'image/png';
    const base64Data = `data:${mimeType};base64,${buffer.toString('base64')}`;

    const result = await cloudinary.uploader.upload(base64Data, {
      folder,
      resource_type: 'image',
    });

    return {
      success: true,
      resource: {
        public_id: result.public_id,
        secure_url: result.secure_url,
        format: result.format,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        created_at: result.created_at,
      },
    };
  } catch (error: any) {
    console.error('Failed to upload to Cloudinary:', error);
    return { success: false, error: error.message || 'Upload failed' };
  }
}

/** Transfer an existing Cloudinary asset into a Supabase Storage bucket */
export async function transferCloudinaryToSupabase(
  publicId: string,
  targetBucket: 'prize-images' | 'site-media' = 'prize-images'
) {
  await requireAdminSession();

  try {
    const cloudinaryUrl = cloudinary.url(publicId, { secure: true });
    const response = await fetch(cloudinaryUrl);
    if (!response.ok) {
      return { success: false, error: `Failed to download from Cloudinary (${response.status})` };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const folder = targetBucket === 'site-media' ? 'uploads' : 'prizes';
    const stored = await storeImage(getAdminDb(), targetBucket, folder, buffer);

    return {
      success: true,
      url: stored.url,
      paths: stored.paths,
      bytes: stored.bytes,
    };
  } catch (error: any) {
    console.error('Failed to transfer from Cloudinary to Supabase:', error);
    return { success: false, error: error.message || 'Transfer failed' };
  }
}

/** Transfer an existing Supabase Storage image into Cloudinary */
export async function transferSupabaseToCloudinary(
  supabaseUrl: string,
  folder: string = 'transfers'
) {
  await requireAdminSession();

  try {
    if (!supabaseUrl) {
      return { success: false, error: 'No Supabase URL provided' };
    }

    const result = await cloudinary.uploader.upload(supabaseUrl, {
      folder,
      resource_type: 'image',
    });

    return {
      success: true,
      publicId: result.public_id,
      url: result.secure_url,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
    };
  } catch (error: any) {
    console.error('Failed to transfer from Supabase to Cloudinary:', error);
    return { success: false, error: error.message || 'Transfer failed' };
  }
}

/** List recent Supabase images from storage buckets to select for transfer */
export async function getSupabaseMediaForPicker() {
  await requireAdminSession();

  try {
    const [prizeRes, siteRes] = await Promise.all([
      listMediaImages('prize-images', 0),
      listMediaImages('site-media', 0),
    ]);

    const images: { url: string; name: string; bucket: string; size: number }[] = [];

    if (prizeRes.success && prizeRes.data?.images) {
      for (const img of prizeRes.data.images) {
        images.push({ url: img.url, name: img.name, bucket: 'prize-images', size: img.size });
      }
    }

    if (siteRes.success && siteRes.data?.images) {
      for (const img of siteRes.data.images) {
        images.push({ url: img.url, name: img.name, bucket: 'site-media', size: img.size });
      }
    }

    return { success: true, images };
  } catch (error: any) {
    console.error('Failed to list Supabase images for picker:', error);
    return { success: false, error: error.message || 'Failed to list images', images: [] };
  }
}
