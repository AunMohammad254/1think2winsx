import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { requirePaymentAccess } from '@/lib/payment-middleware';
import { quizDb, quizAttemptDb, questionAttemptDb, answerDb, dailyPaymentDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { executeCriticalTransaction } from '@/lib/transaction-manager';

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

    // Check if user has already completed this quiz
    const existingAttempt = await quizAttemptDb.findByUserAndQuiz(userId, quizId);
    const hasCompleted = existingAttempt?.isCompleted === true;

    // Get questions that the user has already attempted
    const attemptedQuestions = await questionAttemptDb.findByUserAndQuiz(userId, quizId);
    const attemptedQuestionIds = attemptedQuestions.map((qa: { questionId: string }) => qa.questionId);

    // Check if this is a reattempt with new questions
    const isReattempt = hasCompleted && attemptedQuestionIds.length > 0;

    // If it's not a reattempt and user has already completed, block submission
    if (hasCompleted && !isReattempt) {
      return NextResponse.json(
        { error: 'You have already completed this quiz' },
        { status: 403 }
      );
    }

    // Get quiz with questions
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

    // Validate that all questions are answered
    const questionIds = activeQuestions.map((q: { id: string }) => q.id);
    const answeredQuestionIds = answers.map(a => a.questionId);

    // For reattempts, only validate new questions
    const questionsToValidate = isReattempt
      ? questionIds.filter((qid: string) => !attemptedQuestionIds.includes(qid))
      : questionIds;

    const missingQuestions = questionsToValidate.filter((qid: string) => !answeredQuestionIds.includes(qid));
    if (missingQuestions.length > 0) {
      return NextResponse.json(
        { error: 'All questions must be answered', missingQuestions },
        { status: 400 }
      );
    }

    // Validate that user is only answering new questions in reattempt
    if (isReattempt) {
      const invalidAnswers = answeredQuestionIds.filter(id => attemptedQuestionIds.includes(id));
      if (invalidAnswers.length > 0) {
        return NextResponse.json(
          { error: 'Cannot reanswer previously attempted questions', invalidAnswers },
          { status: 400 }
        );
      }
    }

    const totalQuestions = activeQuestions.length;
    const scorePercentage = 0; // Will be determined during admin evaluation
    const totalPoints = 0;
    const passed = false;

    // Get current payment for reference
    const currentPayment = await dailyPaymentDb.findFirstActive(userId);

    // Create quiz attempt and answers
    const result = await executeCriticalTransaction(async () => {
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
          score: scorePercentage,
          points: totalPoints,
          isCompleted: true,
          isEvaluated: false,
          completedAt: new Date().toISOString(),
          dailyPaymentId: currentPayment?.id || null,
        });
      }

      // Create individual question attempts for tracking
      const questionAttemptRecords = answers.map(answer => ({
        userId,
        questionId: answer.questionId,
        quizId,
        selectedOption: answer.selectedOption,
        isCorrect: false,
        attemptedAt: new Date(),
      }));

      await questionAttemptDb.createMany(questionAttemptRecords);

      // Create individual answers
      const answerRecords = answers.map(answer => ({
        userId,
        questionId: answer.questionId,
        selectedOption: answer.selectedOption,
        quizAttemptId: quizAttempt.id,
        isCorrect: false,
      }));

      await answerDb.createMany(answerRecords);

      return { quizAttempt };
    }, {
      context: 'quiz_submission',
      userId: userId,
      description: `Quiz submission for quiz ${id}`
    });

    recordSecurityEvent('QUIZ_SUBMITTED', request, userId, {
      quizId: quiz.id,
      score: scorePercentage,
      points: totalPoints,
      passed,
      attemptId: result.quizAttempt.id,
    });

    return createSecureJsonResponse({
      message: isReattempt
        ? 'New quiz predictions submitted successfully'
        : 'Quiz predictions submitted successfully',
      results: {
        attemptId: result.quizAttempt.id,
        score: null,
        points: null,
        totalQuestions,
        submittedAnswers: answers.length,
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
      { error: 'Failed to submit quiz' },
      { status: 500 }
    );
  }
}