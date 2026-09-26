import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { requireAuth } from '@/lib/auth-middleware';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import logger from '@/lib/logger';

const evaluationSchema = z.object({
  quizId: z.string().min(1, 'Quiz ID is required'),
  correctAnswers: z.record(z.string(), z.number().min(0).max(9))
});

// POST /api/admin/quiz-evaluation - Add correct answers and evaluate quiz
export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    // Require admin authentication
    const authResult = await requireAuth({ adminOnly: true });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quiz-evaluation'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/quiz-evaluation',
        rateLimiter: 'admin'
      });
      return rateLimitResponse;
    }

    const body = await request.json();

    // Validate input
    const validationResult = evaluationSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { message: 'Invalid input data', errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { quizId, correctAnswers } = validationResult.data;

    // Get quiz with questions and unevaluated attempts
    const supabase = getAdminDb();

    const { data: quiz, error: quizError } = await supabase
      .from('Quiz')
      .select('id, title')
      .eq('id', quizId)
      .single();

    if (quizError || !quiz) {
      return NextResponse.json(
        { message: 'Quiz not found' },
        { status: 404 }
      );
    }

    const { data: questions } = await supabase
      .from('Question')
      .select('id')
      .eq('quizId', quizId);

    // Validate that all questions have correct answers provided
    const questionIds = (questions || []).map((q: { id: string }) => q.id);
    const missingAnswers = questionIds.filter(id => !(id in correctAnswers));

    if (missingAnswers.length > 0) {
      return NextResponse.json(
        { message: 'Missing correct answers for some questions', missingQuestions: missingAnswers },
        { status: 400 }
      );
    }

    // Set-based evaluation inside Postgres. The previous implementation fetched every
    // attempt + every answer into Node (silently truncated at PostgREST's 1,000-row
    // limit), issued one UPDATE per attempt and then `IN (...)` updates listing every
    // answer id — unusable beyond a few thousand participants.
    // One RPC per question keeps each statement short (~2-4 s at 50k attempts).
    const startedAt = Date.now();
    for (const [questionId, correctOption] of Object.entries(correctAnswers)) {
      if (!questionIds.includes(questionId)) continue;
      const { data, error } = await supabase.rpc('evaluate_question', {
        p_question_id: questionId,
        p_correct_option: correctOption as number,
      });
      if (error || !data?.success) {
        console.error('[QUIZ_EVALUATION] evaluate_question failed', questionId, error || data);
        return NextResponse.json({ message: 'Failed to evaluate question', questionId }, { status: 500 });
      }
    }

    const { data: finalize, error: finalizeError } = await supabase.rpc('finalize_quiz_scores', { p_quiz_id: quizId });
    if (finalizeError || !finalize?.success) {
      console.error('[QUIZ_EVALUATION] finalize_quiz_scores failed', finalizeError || finalize);
      return NextResponse.json({ message: 'Failed to finalize quiz scores' }, { status: 500 });
    }

    logger.log(`[QUIZ_EVALUATION] quiz ${quizId}: ${finalize.evaluatedAttempts} attempts in ${Date.now() - startedAt} ms`);

    // Small preview for the admin UI (top 50) instead of every participant.
    const { data: top } = await supabase
      .from('QuizAttempt')
      .select('userId, score, User:userId (email)')
      .eq('quizId', quizId)
      .order('score', { ascending: false })
      .limit(50);
    const evaluationResult = (top || []).map((t: { userId: string; score: number; User: { email?: string } | { email?: string }[] | null }) => {
      const u = Array.isArray(t.User) ? t.User[0] : t.User;
      return {
        userId: t.userId,
        userEmail: u?.email,
        percentage: t.score,
        totalQuestions: finalize.totalQuestions as number,
      };
    });
    const evaluatedCount = finalize.evaluatedAttempts as number;

    return createSecureJsonResponse({
      success: true,
      message: 'Quiz evaluated successfully',
      evaluatedAttempts: evaluatedCount,
      results: evaluationResult
    }, { status: 200 });

  } catch (error) {
    console.error('Error evaluating quiz:', error);

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/admin/quiz-evaluation - Get quiz evaluation status
export async function GET(request: NextRequest) {
  try {
    // Require admin authentication
    const authResult = await requireAuth({ adminOnly: true });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quiz-evaluation'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/quiz-evaluation',
        rateLimiter: 'admin',
        method: 'GET'
      });
      return rateLimitResponse;
    }

    const url = new URL(request.url);
    const quizId = url.searchParams.get('quizId');

    if (!quizId) {
      return NextResponse.json(
        { message: 'Quiz ID is required' },
        { status: 400 }
      );
    }

    const supabase = getAdminDb();

    // Get quiz with evaluation status
    const { data: quiz, error: quizError } = await supabase
      .from('Quiz')
      .select('id, title, prizeId')
      .eq('id', quizId)
      .single();

    if (quizError || !quiz) {
      return NextResponse.json(
        { message: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Get questions
    const { data: questions } = await supabase
      .from('Question')
      .select('id, text, options, correctOption, hasCorrectAnswer')
      .eq('quizId', quizId);

    // Get attempts with user info
    const { data: attempts } = await supabase
      .from('QuizAttempt')
      .select(`
        id, userId, score, isEvaluated, createdAt,
        User:userId (email, name)
      `)
      .eq('quizId', quizId);

    const totalAttempts = (attempts || []).length;
    const evaluatedAttempts = (attempts || []).filter((a: { isEvaluated: boolean }) => a.isEvaluated).length;
    const pendingAttempts = totalAttempts - evaluatedAttempts;
    const questionsWithAnswers = (questions || []).filter((q: { hasCorrectAnswer: boolean }) => q.hasCorrectAnswer).length;

    return createSecureJsonResponse({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        prizeId: quiz.prizeId,
        totalQuestions: (questions || []).length,
        questionsWithAnswers
      },
      evaluation: {
        totalAttempts,
        evaluatedAttempts,
        pendingAttempts,
        isFullyEvaluated: pendingAttempts === 0 && (questions || []).every((q: { hasCorrectAnswer: boolean }) => q.hasCorrectAnswer)
      },
      questions: questions || [],
      attempts: (attempts || []).map((a: any) => {
        const userRaw = a.User;
        const user = Array.isArray(userRaw) ? userRaw[0] : userRaw;
        return {
          ...a,
          user: user
        };
      })
    }, { status: 200 });

  } catch (error) {
    console.error('Error getting quiz evaluation status:', error);

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}