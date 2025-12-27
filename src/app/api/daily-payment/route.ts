import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dailyPaymentDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';

const dailyPaymentSchema = z.object({
  amount: z.number().min(0.01).max(1000),
  paymentMethod: z.string().optional(),
  transactionId: z.string().optional(),
});

// POST /api/daily-payment - Create a new daily payment for 24h quiz access
export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    // Require authentication
    const authResult = await requireAuth({
      context: 'daily_payment_creation',
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
      '/api/daily-payment'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, userId, {
        endpoint: '/api/daily-payment',
        rateLimiter: 'payment',
      });
      return rateLimitResponse;
    }

    // Check if user already has valid access (within 24 hours)
    const existingPayment = await dailyPaymentDb.findFirstActive(userId);

    if (existingPayment) {
      return createSecureJsonResponse({
        message: 'You already have active quiz access',
        payment: {
          id: existingPayment.id,
          amount: existingPayment.amount,
          status: existingPayment.status,
          expiresAt: existingPayment.expiresAt,
        },
        hasAccess: true
      }, { status: 200 });
    }

    const body = await request.json();
    const validationResult = dailyPaymentSchema.safeParse(body);

    if (!validationResult.success) {
      recordSecurityEvent('INVALID_INPUT', request, userId, {
        endpoint: '/api/daily-payment',
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid payment data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { amount, paymentMethod, transactionId } = validationResult.data;

    // Calculate expiry time (24 hours from now)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Create payment record
    const payment = await dailyPaymentDb.create({
      userId,
      amount,
      status: 'completed',
      paymentMethod: paymentMethod || 'demo',
      transactionId: transactionId || `daily_txn_${Date.now()}_${userId}`,
      expiresAt: expiresAt.toISOString(),
    });

    recordSecurityEvent('PAYMENT_CREATED', request, userId, {
      paymentId: payment.id,
      amount: payment.amount,
      expiresAt: payment.expiresAt,
    });

    return createSecureJsonResponse({
      message: 'Daily payment successful! You now have 24-hour quiz access.',
      payment: {
        id: payment.id,
        amount: payment.amount,
        status: payment.status,
        expiresAt: payment.expiresAt,
      },
      hasAccess: true
    }, { status: 201 });

  } catch (error) {
    console.error('Daily payment creation error:', error);
    recordSecurityEvent('PAYMENT_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to process daily payment' },
      { status: 500 }
    );
  }
}