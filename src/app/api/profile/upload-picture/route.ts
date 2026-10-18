import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb, userDb } from '@/lib/supabase/db';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { securityLogger } from '@/lib/security-logger';
import { createSecureFileUploadResponse } from '@/lib/security-headers';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { isCloudinaryUrl } from '@/lib/cloudinary';
import { deleteCloudinaryImageByUrl } from '@/lib/cloudinary-server';
import { MEDIA_BUCKETS } from '@/lib/media/config';
import { InvalidImageError } from '@/lib/media/image-processing';
import { deleteStoredImage, removeFolderExcept, storeImage } from '@/lib/media/storage.server';

type StorageClient = Awaited<ReturnType<typeof getDb>>;

/**
 * Deletes a player's previous profile pictures right away: every other file in their
 * avatars/<userId>/ folder (also catches leftovers from an earlier failed delete), and an
 * older Cloudinary avatar. Failures are logged, never shown to the player.
 */
async function deletePreviousPictures(
  client: StorageClient,
  userId: string,
  keep: string[],
  previousUrl: string | null | undefined,
) {
  try {
    await removeFolderExcept(client, MEDIA_BUCKETS.avatar, userId, keep);
  } catch (error) {
    console.error('Failed to delete old profile pictures:', error);
  }
  if (isCloudinaryUrl(previousUrl)) {
    await deleteCloudinaryImageByUrl(previousUrl); // logs and returns false on failure
  }
}

export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const session = await auth();

    if (!session || !session.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Apply rate limiting for file uploads
    const rateLimitResult = await applyRateLimit(rateLimiters.fileUpload, request, userId);
    if (rateLimitResult) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, userId, {
        endpoint: '/api/profile/upload-picture',
        rateLimiter: 'fileUpload'
      });
      securityLogger.logSecurityEvent({
        type: 'RATE_LIMIT_EXCEEDED',
        userId,
        endpoint: '/api/profile/upload-picture',
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      });
      return rateLimitResult;
    }

    const formData = await request.formData();
    const file = formData.get('profilePicture') as File;

    if (!file) {
      return NextResponse.json({ message: 'No file provided' }, { status: 400 });
    }

    // Enhanced MIME type validation
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      recordSecurityEvent('INVALID_FILE_TYPE', request, userId, {
        fileName: file.name,
        fileType: file.type,
        allowedTypes
      });
      securityLogger.logSecurityEvent({
        type: 'INVALID_INPUT',
        userId,
        details: { fileName: file.name, fileType: file.type, reason: 'Invalid file type' },
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      });
      return NextResponse.json(
        { message: 'Invalid file type. Please upload JPEG, PNG, WebP, or GIF images.' },
        { status: 400 }
      );
    }

    // Validate file size (5MB limit)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      recordSecurityEvent('FILE_SIZE_EXCEEDED', request, userId, {
        fileName: file.name,
        fileSize: file.size,
        maxSize
      });
      securityLogger.logSecurityEvent({
        type: 'INVALID_INPUT',
        userId,
        details: { fileName: file.name, fileSize: file.size, reason: 'File size exceeded' },
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      });
      return NextResponse.json(
        { message: 'File size too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Remember the current picture so it can be deleted once the new one is saved
    const currentUser = await userDb.findById(userId);

    // The player's own session client: the storage policies only let it write avatars/<userId>/
    const storage = await getDb();

    let stored;
    try {
      // Cropped to a 256px WebP square here, once, so pages link straight to it
      stored = await storeImage(storage, MEDIA_BUCKETS.avatar, userId, buffer);
    } catch (imageError) {
      if (imageError instanceof InvalidImageError) {
        return NextResponse.json({ message: 'The file could not be read as an image.' }, { status: 400 });
      }
      console.error('Profile picture storage error:', imageError);
      return NextResponse.json({ message: 'Failed to store the image' }, { status: 500 });
    }

    try {
      await userDb.update(userId, { profilePicture: stored.url });
    } catch (dbError) {
      // Don't keep a file the profile doesn't point to
      await deleteStoredImage(storage, stored.url).catch(() => undefined);
      throw dbError;
    }

    await deletePreviousPictures(storage, userId, stored.paths, currentUser?.profilePicture);

    return createSecureFileUploadResponse({
      message: 'Profile picture uploaded successfully',
      imageUrl: stored.url
    }, { status: 200 });

  } catch (error) {
    console.error('Profile picture upload error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;

    const session = await auth();

    if (!session || !session.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const currentUser = await userDb.findById(userId);

    // Clear the profile first so it never points at a deleted file
    await userDb.update(userId, {
      profilePicture: null,
    });

    await deletePreviousPictures(await getDb(), userId, [], currentUser?.profilePicture);

    return NextResponse.json({
      message: 'Profile picture removed successfully'
    }, { status: 200 });

  } catch (error) {
    console.error('Profile picture removal error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
