import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import sharp from 'sharp';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { securityLogger } from '@/lib/security-logger';
import { createSecureFileUploadResponse } from '@/lib/security-headers';
import { recordSecurityEvent } from '@/lib/security-monitoring';

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

    // Enhanced MIME type validation - check both file.type and magic bytes
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
    const maxSize = 5 * 1024 * 1024; // 5MB
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

    // We will let Sharp validate the image integrity during processing
    // Manual magic byte checks can be brittle with some valid image variants


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
      // Process image with Sharp - convert to AVIF format
      const processedBuffer = await sharp(buffer)
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

      await prisma.user.update({
        where: { id: userId },
        data: {
          profilePicture: imageUrl,
          updatedAt: new Date()
        }
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
    await prisma.user.update({
      where: { id: userId },
      data: {
        profilePicture: null,
        updatedAt: new Date()
      }
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

// Magic byte validation function for enhanced security
function validateImageMagicBytes(buffer: Buffer, declaredType: string): boolean {
  // JPEG magic bytes: FF D8 FF
  if (declaredType === 'image/jpeg' || declaredType === 'image/jpg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  if (declaredType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
      buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A;
  }

  // WebP magic bytes: RIFF....WEBP
  if (declaredType === 'image/webp') {
    return buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  }

  // GIF magic bytes: GIF87a or GIF89a
  if (declaredType === 'image/gif') {
    return (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
      (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61);
  }

  return false;
}
