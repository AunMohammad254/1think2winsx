import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
// User creation is now handled by database trigger

const paymentSchema = z.object({
  paymentMethod: z.string().optional(),
  transactionId: z.string().optional(),
});

// POST /api/payments - Create a new payment for 24h quiz access
export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    // Require authentication
    const authResult = await requireAuth({
      context: 'payment_creation',
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;
    const userId = session.user.id;

    // Apply rate limiting
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.general,
      request,
      userId,
      '/api/payments'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, userId, {
        endpoint: '/api/payments',
        rateLimiter: 'payment',
      });
      return rateLimitResponse;
    }

    // Check if user already has valid access (within 24 hours)
    const now = new Date();
    const existingPayment = await prisma.dailyPayment.findFirst({
      where: {
        userId,
        status: 'completed',
        expiresAt: {
          gt: now
        }
      },
      orderBy: {
        expiresAt: 'desc'
      }
    });

    if (existingPayment) {
      return createSecureJsonResponse({
        message: 'You already have active quiz access',
        expiresAt: existingPayment.expiresAt,
        hasAccess: true
      }, { status: 200 });
    }

    const body = await request.json();
    const validationResult = paymentSchema.safeParse(body);

    if (!validationResult.success) {
      recordSecurityEvent('INVALID_INPUT', request, userId, {
        endpoint: '/api/payments',
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid payment data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { paymentMethod, transactionId } = validationResult.data;

    // User is auto-created via database trigger on signup

    // Calculate expiry time (24 hours from now)
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Create payment record
    const payment = await prisma.dailyPayment.create({
      data: {
        userId,
        amount: 2.0, // 2 PKR
        status: 'completed', // For demo purposes, marking as completed immediately
        paymentMethod: paymentMethod || 'demo',
        transactionId: transactionId || `txn_${Date.now()}_${userId}`,
        expiresAt,
      },
    });

    recordSecurityEvent('PAYMENT_CREATED', request, userId, {
      paymentId: payment.id,
      amount: payment.amount,
      expiresAt: payment.expiresAt,
    });

    return createSecureJsonResponse({
      message: 'Payment successful! You now have 24-hour quiz access.',
      payment: {
        id: payment.id,
        amount: payment.amount,
        status: payment.status,
        expiresAt: payment.expiresAt,
      },
      hasAccess: true
    }, { status: 201 });

  } catch (error) {
    console.error('Payment creation error:', error);
    recordSecurityEvent('PAYMENT_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to process payment' },
      { status: 500 }
    );
  }
}

// GET /api/payments - Check payment status and access
export async function GET(request: NextRequest) {
  try {
    // Require authentication
    const authResult = await requireAuth({
      context: 'payment_status',
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;
    const userId = session.user.id;

    // Apply rate limiting
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.general,
      request,
      userId,
      '/api/payments'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const now = new Date();

    // Get current valid payment
    const currentPayment = await prisma.dailyPayment.findFirst({
      where: {
        userId,
        status: 'completed',
        expiresAt: {
          gt: now
        }
      },
      orderBy: {
        expiresAt: 'desc'
      }
    });

    // Get payment history (last 10 payments)
    const paymentHistory = await prisma.dailyPayment.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10,
      select: {
        id: true,
        amount: true,
        status: true,
        paymentMethod: true,
        expiresAt: true,
        createdAt: true,
      }
    });

    const hasAccess = !!currentPayment;
    const timeRemaining = currentPayment
      ? Math.max(0, currentPayment.expiresAt.getTime() - now.getTime())
      : 0;

    return createSecureJsonResponse({
      hasAccess,
      currentPayment: currentPayment ? {
        id: currentPayment.id,
        amount: currentPayment.amount,
        expiresAt: currentPayment.expiresAt,
        timeRemaining: Math.floor(timeRemaining / 1000), // in seconds
      } : null,
      paymentHistory
    }, { status: 200 });

  } catch (error) {
    console.error('Payment status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check payment status' },
      { status: 500 }
    );
  }
}