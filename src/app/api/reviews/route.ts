import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { reviewDb } from '@/lib/supabase/db';
import { reviewInputSchema, toOwnReview } from '@/lib/reviews';
import { getPublicReviews, invalidatePublicReviews } from '@/lib/review-service';

/**
 * GET /api/reviews - the approved reviews and their average, for the home page. Public, and the same
 * for everyone, so browsers may keep it for a minute (the server keeps it a minute too).
 */
export async function GET() {
  try {
    return NextResponse.json(await getPublicReviews(), {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' },
    });
  } catch (error) {
    console.error('[reviews] list failed:', error);
    return NextResponse.json({ error: 'Could not load reviews' }, { status: 500 });
  }
}

/**
 * POST /api/reviews - the signed-in player's review (rating, comment, displayName, city). Writing
 * again edits their one review. Either way it waits for an admin to approve it on /admin/reviews.
 */
export async function POST(request: NextRequest) {
  try {
    const csrfResult = await requireCSRFToken(request);
    if (csrfResult) return csrfResult;

    const authResult = await requireAuth({ context: 'review_submit' });
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.session.user.id;

    const rateLimitResponse = await applyRateLimit(rateLimiters.review, request, userId, '/api/reviews');
    if (rateLimitResponse) return rateLimitResponse;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const validation = reviewInputSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.issues[0].message, details: validation.error.issues }, { status: 400 });
    }

    const review = await reviewDb.upsertForUser(userId, validation.data);
    // An approved review that was edited leaves the public list until it is approved again
    invalidatePublicReviews();
    return createSecureJsonResponse(
      { review: toOwnReview(review), message: 'Thanks! Your review will appear once our team has approved it.' },
      { status: 201 },
    );
  } catch (error) {
    console.error('[reviews] submit failed:', error);
    return NextResponse.json({ error: 'Could not save your review. Please try again.' }, { status: 500 });
  }
}
