import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { requirePaymentAccess } from '@/lib/payment-middleware';
import { quizDb, quizAttemptDb, questionAttemptDb, dailyPaymentDb, getDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';

const submitQuizSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string(),
    selectedOption: z.number(),
  })),
});

// POST /api/quizzes/[id]/submit - Submit quiz answers
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Apply CSRF protection
    const csrfResult = await requireCSRFToken(request);
    if (csrfResult instanceof NextResponse) {
      return csrfResult;
    }

    const authResult = await requireAuth({
      context: 'quiz_submission',
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;
    const userId = session.user.id;
    const quizId = id;

    // Apply rate limiting
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.general,
      request,
      userId,
      '/api/quizzes/[id]/submit'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, userId, {
        endpoint: '/api/quizzes/[id]/submit',
        rateLimiter: 'quiz',
      });
      return rateLimitResponse;
    }

    // Check payment access
    const paymentAccessResponse = await requirePaymentAccess(userId, request);
    if (paymentAccessResponse) {
      return paymentAccessResponse;
    }

    const body = await request.json();
    const validationResult = submitQuizSchema.safeParse(body);

    if (!validationResult.success) {
      recordSecurityEvent('INVALID_INPUT', request, userId, {
        endpoint: '/api/quizzes/[id]/submit',
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid submission data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { answers } = validationResult.data;

    // Get quiz to validate it exists and is active
    const quiz = await quizDb.findByIdWithQuestions(quizId);

    if (!quiz || quiz.status !== 'active') {
      return NextResponse.json(
        { error: 'Quiz not found or inactive' },
        { status: 404 }
      );
    }

    const activeQuestions = (quiz.questions || []).filter(
      (q: { status: string }) => q.status === 'active'
    );

    const totalQuestions = activeQuestions.length;

    // Get current payment for reference
    const currentPayment = await dailyPaymentDb.findFirstActive(userId);

    // Try to use the RPC function first (handles unique constraints properly)
    const supabase = await getDb();

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'submit_quiz_attempt',
      {
        p_user_id: userId,
        p_quiz_id: quizId,
        p_answers: answers,
        p_daily_payment_id: currentPayment?.id || null
      }
    );

    // If RPC function exists and works, use its result
    if (!rpcError && rpcResult && rpcResult.success) {
      recordSecurityEvent('QUIZ_SUBMITTED', request, userId, {
        quizId: quiz.id,
        attemptId: rpcResult.attemptId,
        answersSubmitted: rpcResult.answersSubmitted,
        isReattempt: rpcResult.isReattempt,
      });

      return createSecureJsonResponse({
        message: rpcResult.isReattempt
          ? 'New quiz predictions submitted successfully'
          : 'Quiz predictions submitted successfully',
        results: {
          attemptId: rpcResult.attemptId,
          score: null,
          points: null,
          totalQuestions,
          submittedAnswers: rpcResult.answersSubmitted,
          status: 'pending_evaluation',
          isReattempt: rpcResult.isReattempt,
          note: rpcResult.isReattempt
            ? 'Your predictions for the new questions have been submitted. The admin will review all submissions and add correct answers. Points will be allocated to top performers based on accuracy.'
            : 'Your predictions have been submitted. The admin will review all submissions and add correct answers. Points will be allocated to top performers based on accuracy.'
        }
      }, { status: 200 });
    }

    // If RPC returned an error result
    if (rpcResult && !rpcResult.success) {
      console.error('RPC quiz submission error:', rpcResult.error);
      return NextResponse.json(
        { error: rpcResult.error || 'Failed to submit quiz' },
        { status: 500 }
      );
    }

    // Fallback: If RPC function doesn't exist, use direct database operations
    // This handles the case where the SQL hasn't been run yet
    console.log('RPC function not available, using fallback submission method');

    // Check if user has already completed this quiz
    const existingAttempt = await quizAttemptDb.findByUserAndQuiz(userId, quizId);
    const hasCompleted = existingAttempt?.isCompleted === true;

    // Get questions that the user has already attempted
    const attemptedQuestions = await questionAttemptDb.findByUserAndQuiz(userId, quizId);
    const attemptedQuestionIds = attemptedQuestions.map((qa: { questionId: string }) => qa.questionId);

    const isReattempt = hasCompleted && attemptedQuestionIds.length > 0;

    let quizAttempt;

    if (isReattempt && existingAttempt) {
      // Update existing attempt if it's a reattempt
      quizAttempt = await quizAttemptDb.update(existingAttempt.id, {
        completedAt: new Date().toISOString(),
        isEvaluated: false,
      });
    } else {
      // Create new quiz attempt
      quizAttempt = await quizAttemptDb.create({
        userId,
        quizId,
        score: 0,
        points: 0,
        isCompleted: true,
        isEvaluated: false,
        completedAt: new Date().toISOString(),
        dailyPaymentId: currentPayment?.id || null,
      });
    }

    // Insert answers and question attempts with conflict handling
    let answersSubmitted = 0;
    for (const answer of answers) {
      try {
        // Try to insert/update QuestionAttempt using upsert
        await supabase
          .from('QuestionAttempt')
          .upsert({
            userId,
            questionId: answer.questionId,
            quizId,
            selectedOption: answer.selectedOption,
            isCorrect: false,
            attemptedAt: new Date().toISOString(),
          }, {
            onConflict: 'userId,questionId',
            ignoreDuplicates: false
          });

        // Insert Answer (these are always new per attempt)
        await supabase
          .from('Answer')
          .insert({
            userId,
            questionId: answer.questionId,
            quizAttemptId: quizAttempt.id,
            selectedOption: answer.selectedOption,
            isCorrect: false,
            createdAt: new Date().toISOString(),
          });

        answersSubmitted++;
      } catch (insertError) {
        console.error('Error inserting answer:', insertError);
        // Continue with other answers
      }
    }

    recordSecurityEvent('QUIZ_SUBMITTED', request, userId, {
      quizId: quiz.id,
      attemptId: quizAttempt.id,
      answersSubmitted,
      isReattempt,
      method: 'fallback'
    });

    return createSecureJsonResponse({
      message: isReattempt
        ? 'New quiz predictions submitted successfully'
        : 'Quiz predictions submitted successfully',
      results: {
        attemptId: quizAttempt.id,
        score: null,
        points: null,
        totalQuestions,
        submittedAnswers: answersSubmitted,
        status: 'pending_evaluation',
        isReattempt,
        note: isReattempt
          ? 'Your predictions for the new questions have been submitted. The admin will review all submissions and add correct answers. Points will be allocated to top performers based on accuracy.'
          : 'Your predictions have been submitted. The admin will review all submissions and add correct answers. Points will be allocated to top performers based on accuracy.'
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Quiz submission error:', error);
    recordSecurityEvent('QUIZ_SUBMISSION_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      quizId: id,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to submit quiz' },
      { status: 500 }
    );
  }
}