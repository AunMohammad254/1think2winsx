'use server';

import { v2 as cloudinary } from 'cloudinary';
import { requireAdminSession } from '@/lib/admin-session';

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
