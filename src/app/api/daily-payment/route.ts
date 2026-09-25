import { NextRequest, NextResponse } from 'next/server';

// POST /api/daily-payment
// SECURITY: this endpoint used to create a 'completed' DailyPayment for any amount the
// client sent (min 0.01) without charging the wallet — i.e. free 24h quiz access.
// Quiz access is now purchased only through the wallet (pay_quiz_access RPC).
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: 'Gone', message: 'Use the wallet to purchase quiz access.' },
    { status: 410 }
  );
}
