import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { securityLogger } from '@/lib/security-logger';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';

const redeemPrizeSchema = z.object({
  // CUID format: starts with 'c', followed by 24+ alphanumeric lowercase characters
  prizeId: z.string().regex(/^c[a-z0-9]{20,}$/, 'Invalid prize ID format'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100, 'Full name too long').optional(),
  whatsappNumber: z.string().regex(/^\+?[\d\s-()]{10,15}$/, 'Invalid WhatsApp number format').optional(),
  address: z.string().min(10, 'Address must be at least 10 characters').max(500, 'Address too long').optional(),
});

// POST /api/prize-redemption - Redeem a prize with points
export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection for state-changing operations
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    // Apply rate limiting for prize redemption
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.prizeRedemption,
      request,
      undefined,
      '/api/prize-redemption'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, undefined, {
        endpoint: '/api/prize-redemption',
        rateLimiter: 'prizeRedemption'
      });
      return rateLimitResponse;
    }

    const session = await auth();

    if (!session || !session.user) {
      securityLogger.logUnauthorizedAccess(undefined, '/api/prize-redemption', request);
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate input with proper error handling
    const validationResult = redeemPrizeSchema.safeParse(body);
    if (!validationResult.success) {
      securityLogger.logInvalidInput(session.user.id, '/api/prize-redemption', validationResult.error.errors, request);
      return NextResponse.json(
        { message: 'Invalid input', errors: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { prizeId, fullName, whatsappNumber, address } = validationResult.data;

    // Get user's current points by email (since session.user.id is Supabase UUID, not Prisma CUID)
    if (!session.user.email) {
      return NextResponse.json(
        { message: 'User email not found in session' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, points: true },
    });

    if (!user) {
      return NextResponse.json(
        { message: 'User not found. Please ensure your account is synced.' },
        { status: 404 }
      );
    }

    // Get prize details
    const prize = await prisma.prize.findUnique({
      where: { id: prizeId },
      select: {
        id: true,
        name: true,
        pointsRequired: true,
        isActive: true,
        stock: true,
      },
    });

    if (!prize || !prize.isActive) {
      return NextResponse.json(
        { message: 'Prize not found or not available' },
        { status: 404 }
      );
    }

    // Check if prize is in stock
    if (prize.stock !== null && prize.stock <= 0) {
      return NextResponse.json(
        { message: 'This prize is currently out of stock' },
        { status: 400 }
      );
    }

    // Check if user has enough points
    if (user.points < prize.pointsRequired) {
      return NextResponse.json(
        {
          message: 'Insufficient points',
          required: prize.pointsRequired,
          available: user.points,
        },
        { status: 400 }
      );
    }

    // Create redemption request and deduct points in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create redemption record using the Prisma User.id (CUID), not Supabase UUID
      const redemption = await tx.prizeRedemption.create({
        data: {
          userId: user.id, // Use Prisma CUID, not session.user.id (Supabase UUID)
          prizeId: prizeId,
          pointsUsed: prize.pointsRequired,
          status: 'pending',
          fullName: fullName || null,
          whatsappNumber: whatsappNumber || null,
          address: address || null,
        },
        include: {
          prize: {
            select: {
              name: true,
              description: true,
              imageUrl: true,
            },
          },
        },
      });

      // Deduct points from user using Prisma CUID
      await tx.user.update({
        where: { id: user.id },
        data: {
          points: {
            decrement: prize.pointsRequired,
          },
        },
      });

      // Decrement stock if applicable
      if (prize.stock !== null && prize.stock > 0) {
        await tx.prize.update({
          where: { id: prizeId },
          data: {
            stock: {
              decrement: 1,
            },
          },
        });
      }

      return redemption;
    });



    // Log successful prize redemption
    securityLogger.logSecurityEvent({
      type: 'PRIZE_REDEMPTION',
      userId: session.user.id,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/prize-redemption',
      details: {
        prizeId,
        prizeName: result.prize.name,
        pointsUsed: result.pointsUsed
      },
      severity: 'LOW'
    });

    return createSecureJsonResponse({
      message: 'Prize redeemed successfully',
      redemption: {
        id: result.id,
        prizeName: result.prize.name,
        pointsUsed: result.pointsUsed,
        status: result.status,
        requestedAt: result.requestedAt,
      },
    }, { status: 201 });

  } catch (error) {
    console.error('Error redeeming prize:', error);

    // Log security event for errors
    securityLogger.logSecurityEvent({
      type: 'API_ERROR',
      userId: undefined,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/prize-redemption',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        action: 'REDEEM_PRIZE'
      },
      severity: 'MEDIUM'
    });

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: 'Invalid input data', errors: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/prize-redemption - Get user's redemption history
export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting for GET requests
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.general,
      request,
      undefined,
      '/api/prize-redemption'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, undefined, {
        endpoint: '/api/prize-redemption',
        rateLimiter: 'general'
      });
      return rateLimitResponse;
    }

    const session = await auth();

    if (!session || !session.user || !session.user.email) {
      securityLogger.logUnauthorizedAccess(undefined, '/api/prize-redemption', request);
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Look up user by email to get Prisma CUID
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json(
        { message: 'User not found. Please ensure your account is synced.', redemptions: [] },
        { status: 200 } // Return 200 with empty array instead of 404
      );
    }

    const redemptions = await prisma.prizeRedemption.findMany({
      where: { userId: user.id }, // Use Prisma CUID, not Supabase UUID
      include: {
        prize: {
          select: {
            name: true,
            description: true,
            imageUrl: true,
            type: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });

    return createSecureJsonResponse({ redemptions });

  } catch (error) {
    console.error('Error fetching redemption history:', error);

    // Log security event for errors
    securityLogger.logSecurityEvent({
      type: 'API_ERROR',
      userId: undefined,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/prize-redemption',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        action: 'GET_REDEMPTION_HISTORY'
      },
      severity: 'MEDIUM'
    });

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
