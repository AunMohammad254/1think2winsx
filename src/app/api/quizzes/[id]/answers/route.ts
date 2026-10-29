import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getDb } from '@/lib/supabase/db';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { createSecureJsonResponse } from '@/lib/security-headers';

/**
 * GET /api/quizzes/[id]/answers - the signed-in player's own answers to a quiz, question by question. The
 * match screen reads it once when it opens: everything else it shows comes from the shared, cached
 * /api/live/matches/[id], and answers given on the screen are kept there. One query, never cached.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: quizId } = await params;
  try {
    const authResult = await requireAuth({ context: 'quiz_answers' });
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.session.user.id;

    const rateLimitResponse = await applyRateLimit(rateLimiters.general, request, userId, '/api/quizzes/[id]/answers');
    if (rateLimitResponse) return rateLimitResponse;

    const supabase = await getDb();
    const { data, error } = await supabase.from('QuestionAttempt').select('questionId, selectedOption')
      .eq('userId', userId).eq('quizId', quizId);
    if (error) throw error;
    return createSecureJsonResponse({ answers: data || [] }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Quiz answers error:', error);
    return NextResponse.json({ error: 'Failed to load your answers' }, { status: 500 });
  }
}
