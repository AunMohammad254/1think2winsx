import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { reviewDb } from '@/lib/supabase/db';
import { toOwnReview } from '@/lib/reviews';

/** GET /api/reviews/mine - the signed-in player's review and its status, or null if they haven't written one */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth({ context: 'review_mine' });
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.session.user.id;

    const rateLimitResponse = await applyRateLimit(rateLimiters.general, request, userId, '/api/reviews/mine');
    if (rateLimitResponse) return rateLimitResponse;

    const review = await reviewDb.findByUser(userId);
    return createSecureJsonResponse({ review: review ? toOwnReview(review) : null }, { status: 200 });
  } catch (error) {
    console.error('[reviews] own review failed:', error);
    return NextResponse.json({ error: 'Could not load your review' }, { status: 500 });
  }
}
