import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getAdminDb } from '@/lib/supabase/db';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_ERROR,
  MEDIA_BUCKETS,
  MEDIA_FOLDERS,
  UPLOAD_IMAGE_TYPES,
  UPLOAD_IMAGE_TYPES_ERROR,
} from '@/lib/media/config';
import { assertSupportedImage, InvalidImageError } from '@/lib/media/image-processing';
import { storeImage } from '@/lib/media/storage.server';
import { isCloudinaryFolder, uploadImageToCloudinary } from '@/lib/cloudinary-server';

const ALLOWED_TYPES = new Set(UPLOAD_IMAGE_TYPES);

/**
 * Where an admin upload goes: `target=site` -> site-media/uploads, `target=cloudinary` -> the
 * Cloudinary `folder`, anything else -> prize-images/prizes
 */
const TARGETS = {
  prize: { bucket: MEDIA_BUCKETS.prize, folder: MEDIA_FOLDERS.prizes },
  site: { bucket: MEDIA_BUCKETS.site, folder: MEDIA_FOLDERS.siteUploads },
} as const;

/**
 * Admin image upload to Supabase Storage. The image is resized and converted to WebP here,
 * once, so pages can link straight to the stored sizes.
 */
export async function POST(req: Request) {
  try {
    // Admins only: accepts the admin-panel cookie or a Supabase login in ADMIN_EMAILS
    // (the old `session.user.role` check never existed, so every upload got 401)
    const authResult = await requireAuth({ adminOnly: true, context: 'media_upload' });
    if (authResult instanceof NextResponse) return authResult;

    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: UPLOAD_IMAGE_TYPES_ERROR }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: MAX_UPLOAD_ERROR }, { status: 400 });
    }

    const target = formData.get('target');
    if (target === 'cloudinary') {
      // The Cloudinary page's direct upload: stored as sent, into the chosen folder
      const cloudFolder = formData.get('folder') ?? 'uploads';
      if (!isCloudinaryFolder(cloudFolder)) {
        return NextResponse.json({ error: 'Folder names may use letters, digits, - and _ only' }, { status: 400 });
      }
      const image = Buffer.from(await file.arrayBuffer());
      await assertSupportedImage(image);
      const uploaded = await uploadImageToCloudinary(image, cloudFolder);
      return NextResponse.json({ url: uploaded.url, resource: uploaded }, { status: 200 });
    }

    // No target (e.g. a prize form loaded before this deploy) means prize-images
    const { bucket, folder } = target === 'site' ? TARGETS.site : TARGETS.prize;
    const stored = await storeImage(getAdminDb(), bucket, folder, Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({ url: stored.url }, { status: 200 });
  } catch (error) {
    if (error instanceof InvalidImageError) {
      return NextResponse.json({ error: 'The file could not be read as an image' }, { status: 400 });
    }
    console.error('Error uploading image to Supabase Storage:', error);
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
  }
}
