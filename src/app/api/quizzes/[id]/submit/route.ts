import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';

const submitQuizSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().min(1).max(100),
    selectedOption: z.number().int().min(0).max(9),
  })).min(1).max(200),
});

const NOTE_FIRST =
  'Your predictions have been submitted. The admin will review all submissions and add correct answers. Points will be allocated to top performers based on accuracy.';
const NOTE_REATTEMPT =
  'Your predictions for the new questions have been submitted. The admin will review all submissions and add correct answers. Points will be allocated to top performers based on accuracy.';

const RPC_ERROR_STATUS: Record<string, number> = {
  payment_required: 402,
  not_found: 404,
  invalid: 400,
  forbidden: 403,
};

/**
 * POST /api/quizzes/[id]/submit — Submit quiz answers
 *
 * PERFORMANCE: previously ~8 sequential Supabase round-trips per submission
 * (auth, 3x rate-limit table, payment lookup twice, quiz+questions fetch, RPC) and
 * a non-atomic fallback path doing 2 inserts per answer. All business rules
 * (quiz active, active payment, valid/unrevealed questions, one attempt per user,
 * predictions final) are now enforced inside the `submit_quiz_attempt` database
 * function in a single transaction, so this handler is: auth + 1 RPC.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: quizId } = await params;

  try {
    const csrfResult = await requireCSRFToken(request);
    if (csrfResult) return csrfResult;

    const authResult = await requireAuth({ context: 'quiz_submission' });
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.session.user.id;

    const rateLimitResponse = await applyRateLimit(rateLimiters.quiz, request, userId, '/api/quizzes/[id]/submit');
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, userId, { endpoint: '/api/quizzes/[id]/submit', rateLimiter: 'quiz' });
      return rateLimitResponse;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const validation = submitQuizSchema.safeParse(body);
    if (!validation.success) {
      recordSecurityEvent('INVALID_INPUT', request, userId, { endpoint: '/api/quizzes/[id]/submit' });
      return NextResponse.json(
        { error: 'All questions must be answered before submitting', details: validation.error.issues },
        { status: 400 }
      );
    }

    const supabase = await getDb();
    const { data, error } = await supabase.rpc('submit_quiz_attempt', {
      p_user_id: userId,
      p_quiz_id: quizId,
      p_answers: validation.data.answers,
      p_daily_payment_id: null,
    });

    if (error || !data) {
      console.error('submit_quiz_attempt RPC error:', error);
      recordSecurityEvent('QUIZ_SUBMISSION_ERROR', request, userId, { quizId });
      return NextResponse.json({ error: 'Failed to submit quiz' }, { status: 500 });
    }

    const r = data as {
      success: boolean; code?: string; error?: string; attemptId?: string;
      answersSubmitted?: number; isReattempt?: boolean; totalQuestions?: number;
    };

    if (!r.success) {
      const status = RPC_ERROR_STATUS[r.code || ''] ?? 500;
      if (status === 400 || status === 403) {
        recordSecurityEvent('INVALID_INPUT', request, userId, { endpoint: '/api/quizzes/[id]/submit', code: r.code || 'unknown' });
      }
      return NextResponse.json(
        { error: r.error || 'Failed to submit quiz', ...(status === 402 ? { requiresPayment: true } : {}) },
        { status }
      );
    }

    recordSecurityEvent('QUIZ_SUBMITTED', request, userId, {
      quizId,
      attemptId: r.attemptId,
      answersSubmitted: r.answersSubmitted,
      isReattempt: r.isReattempt,
    });

    return createSecureJsonResponse({
      message: r.isReattempt
        ? 'New quiz predictions submitted successfully'
        : 'Quiz predictions submitted successfully',
      results: {
        attemptId: r.attemptId,
        score: null,
        points: null,
        totalQuestions: r.totalQuestions ?? validation.data.answers.length,
        submittedAnswers: r.answersSubmitted,
        status: 'pending_evaluation',
        isReattempt: r.isReattempt,
        note: r.isReattempt ? NOTE_REATTEMPT : NOTE_FIRST,
      },
    }, { status: 200 });
  } catch (error) {
    console.error('Quiz submission error:', error);
    recordSecurityEvent('QUIZ_SUBMISSION_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      quizId,
    });
    return NextResponse.json({ error: 'Failed to submit quiz' }, { status: 500 });
  }
}
