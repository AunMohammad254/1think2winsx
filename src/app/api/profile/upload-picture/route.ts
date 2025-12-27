import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { userDb } from '@/lib/supabase/db';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { securityLogger } from '@/lib/security-logger';
import { createSecureFileUploadResponse } from '@/lib/security-headers';
import { recordSecurityEvent } from '@/lib/security-monitoring';

// Dynamic import for sharp to avoid build issues
let sharp: typeof import('sharp') | null = null;

async function getSharp() {
  if (!sharp) {
    sharp = (await import('sharp')).default;
  }
  return sharp;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session || !session.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Apply rate limiting for file uploads
    const rateLimitResult = await applyRateLimit(rateLimiters.fileUpload, request, session.user.id);
    if (rateLimitResult) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/profile/upload-picture',
        rateLimiter: 'fileUpload'
      });
      securityLogger.logSecurityEvent({
        type: 'RATE_LIMIT_EXCEEDED',
        userId: session.user.id,
        endpoint: '/api/profile/upload-picture',
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      });
      return rateLimitResult;
    }

    const userId = session.user.id;
    const formData = await request.formData();
    const file = formData.get('profilePicture') as File;

    if (!file) {
      return NextResponse.json(
        { message: 'No file provided' },
        { status: 400 }
      );
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
        details: {
          fileName: file.name,
          fileType: file.type,
          reason: 'Invalid file type'
        },
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
        details: {
          fileName: file.name,
          fileSize: file.size,
          reason: 'File size exceeded'
        },
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      });
      return NextResponse.json(
        { message: 'File size too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Create uploads directory if it doesn't exist
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'profile-pictures');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${userId}-${timestamp}.avif`;
    const filepath = join(uploadsDir, filename);

    try {
      const sharpInstance = await getSharp();
      // Process image with Sharp - convert to AVIF format
      const processedBuffer = await sharpInstance(buffer)
        .resize(400, 400, {
          fit: 'cover',
          position: 'center'
        })
        .avif({
          quality: 80,
          effort: 4
        })
        .toBuffer();

      // Save processed image
      await writeFile(filepath, processedBuffer);

      // Update user profile in database
      const imageUrl = `/uploads/profile-pictures/${filename}`;

      await userDb.update(userId, {
        profilePicture: imageUrl,
      });

      return createSecureFileUploadResponse({
        message: 'Profile picture uploaded successfully',
        imageUrl: imageUrl
      }, { status: 200 });

    } catch (imageError) {
      console.error('Image processing error:', imageError);
      return NextResponse.json(
        { message: 'Failed to process image' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Profile picture upload error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest) {
  try {
    const session = await auth();

    if (!session || !session.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Remove profile picture from database
    await userDb.update(userId, {
      profilePicture: null,
    });

    return NextResponse.json({
      message: 'Profile picture removed successfully'
    }, { status: 200 });

  } catch (error) {
    console.error('Profile picture removal error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
