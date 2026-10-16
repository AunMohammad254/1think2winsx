import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dailyPaymentDb } from '@/lib/supabase/db';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { createSecureJsonResponse } from '@/lib/security-headers';


// POST /api/payments - Create a new payment for 24h quiz access
export async function POST(_request: NextRequest) {
  // SECURITY: this endpoint used to create a 'completed' DailyPayment WITHOUT charging
  // anything ("demo" payment), i.e. free 24h quiz access for any signed-in user.
  // Quiz access is now purchased only through the wallet (pay_quiz_access RPC).
  return NextResponse.json(
    { error: 'Gone', message: 'Use the wallet to purchase quiz access.' },
    { status: 410 }
  );
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
    const currentPayment = await dailyPaymentDb.findFirstActive(userId);

    // Get payment history (last 10 payments)
    const paymentHistory = await dailyPaymentDb.findMany(userId, 10);

    const hasAccess = !!currentPayment;
    const timeRemaining = currentPayment
      ? Math.max(0, new Date(currentPayment.expiresAt).getTime() - now.getTime())
      : 0;

    return createSecureJsonResponse({
      hasAccess,
      currentPayment: currentPayment ? {
        id: currentPayment.id,
        amount: currentPayment.amount,
        expiresAt: currentPayment.expiresAt,
        timeRemaining: Math.floor(timeRemaining / 1000),
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