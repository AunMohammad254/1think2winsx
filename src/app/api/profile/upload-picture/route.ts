import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { auth } from '@/lib/auth';
import { userDb } from '@/lib/supabase/db';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { securityLogger } from '@/lib/security-logger';
import { createSecureFileUploadResponse } from '@/lib/security-headers';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { deleteCloudinaryImageByUrl } from '@/lib/cloudinary-server';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

    // Get current user to see if they have an existing profile picture on Cloudinary
    const currentUser = await userDb.findById(userId);

    try {
      // Upload to Cloudinary using a stream
      const uploadResult: any = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { 
            folder: 'avatars',
            transformation: [
              { width: 400, height: 400, crop: 'fill', gravity: 'face' }, // Automatically frame around faces!
              { quality: 'auto', fetch_format: 'avif' }
            ]
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        uploadStream.end(buffer);
      });

      const imageUrl = uploadResult.secure_url;

      // Update user profile in database
      await userDb.update(userId, {
        profilePicture: imageUrl,
      });

      // Clean up old avatar if it was on Cloudinary (to save storage)
      if (currentUser?.profilePicture && currentUser.profilePicture.includes('cloudinary.com')) {
        await deleteCloudinaryImageByUrl(currentUser.profilePicture).catch(e => {
          console.error('Failed to delete old avatar:', e);
        });
      }

      return createSecureFileUploadResponse({
        message: 'Profile picture uploaded successfully',
        imageUrl: imageUrl
      }, { status: 200 });

    } catch (imageError) {
      console.error('Cloudinary Image processing error:', imageError);
      return NextResponse.json({ message: 'Failed to process image through Cloudinary' }, { status: 500 });
    }

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

    // If they have a Cloudinary picture, delete it from the CDN cloud too!
    if (currentUser?.profilePicture && currentUser.profilePicture.includes('cloudinary.com')) {
      await deleteCloudinaryImageByUrl(currentUser.profilePicture).catch(e => {
        console.error('Failed to delete avatar from Cloudinary:', e);
      });
    }

    // Remove profile picture from database
    await userDb.update(userId, {
      profilePicture: null,
    });

    return NextResponse.json({
      message: 'Profile picture removed successfully'
    }, { status: 200 });

  } catch (error) {
    console.error('Profile picture removal error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
