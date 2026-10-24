import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { listQuizPrizes } from '@/lib/quiz-prizes';

/** GET /api/quiz-prizes - the signed-in player's prizes won in quizzes, with their delivery claims */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth({ context: 'quiz_prizes' });
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.session.user.id;

    const rateLimitResponse = await applyRateLimit(rateLimiters.general, request, userId, '/api/quiz-prizes');
    if (rateLimitResponse) return rateLimitResponse;

    return createSecureJsonResponse({ prizes: await listQuizPrizes(userId) }, { status: 200 });
  } catch (error) {
    console.error('Quiz prizes error:', error);
    return NextResponse.json({ error: 'Failed to load your prizes' }, { status: 500 });
  }
}
