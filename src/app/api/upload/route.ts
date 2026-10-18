import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getAdminDb } from '@/lib/supabase/db';
import { MEDIA_BUCKETS, MEDIA_FOLDERS } from '@/lib/media/config';
import { InvalidImageError } from '@/lib/media/image-processing';
import { storeImage } from '@/lib/media/storage.server';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);

/** Where an admin upload goes: `target=site` -> site-media/uploads, anything else -> prize-images/prizes */
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
      return NextResponse.json({ error: 'Only JPEG, PNG, WebP, AVIF or GIF images can be uploaded' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Image must be 10 MB or smaller' }, { status: 400 });
    }

    // No target (e.g. a prize form loaded before this deploy) means prize-images
    const { bucket, folder } = formData.get('target') === 'site' ? TARGETS.site : TARGETS.prize;
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
