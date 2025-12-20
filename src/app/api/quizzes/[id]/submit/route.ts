import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { requirePaymentAccess } from '@/lib/payment-middleware';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { executeCriticalTransaction } from '@/lib/transaction-manager';
// User creation is now handled by database trigger

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

    // User is auto-created via database trigger on signup

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
    const existingAttempt = await prisma.quizAttempt.findFirst({
      where: {
        userId,
        quizId,
        isCompleted: true
      }
    });

    // Get questions that the user has already attempted
    const attemptedQuestions = await prisma.questionAttempt.findMany({
      where: {
        userId,
        quizId
      },
      select: {
        questionId: true
      }
    });

    const attemptedQuestionIds = attemptedQuestions.map((qa: { questionId: string }) => qa.questionId);

    // Check if this is a reattempt with new questions
    const isReattempt = existingAttempt && attemptedQuestionIds.length > 0;

    // If it's not a reattempt and user has already completed, block submission
    if (existingAttempt && !isReattempt) {
      return NextResponse.json(
        { error: 'You have already completed this quiz' },
        { status: 403 }
      );
    }

    // Get quiz with questions and correct answers
    const quiz = await prisma.quiz.findFirst({
      where: {
        id: quizId,
        status: 'active'
      },
      include: {
        questions: {
          where: {
            status: 'active'
          }
        }
      }
    });

    if (!quiz) {
      return NextResponse.json(
        { error: 'Quiz not found or inactive' },
        { status: 404 }
      );
    }

    // Validate that all questions are answered (only for new questions in reattempt)
    const questionIds = quiz.questions.map((q: { id: string }) => q.id);
    const answeredQuestionIds = answers.map(a => a.questionId);

    // For reattempts, only validate new questions
    const questionsToValidate = isReattempt
      ? questionIds.filter((id: string) => !attemptedQuestionIds.includes(id))
      : questionIds;

    const missingQuestions = questionsToValidate.filter((id: string) => !answeredQuestionIds.includes(id));
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

    // For prediction-based quizzes, don't calculate scores immediately
    // Store answers for later evaluation by admin
    const answerResults = answers.map(answer => {
      const question = quiz.questions.find((q: { id: string; text: string }) => q.id === answer.questionId);
      return {
        ...answer,
        questionText: question?.text || 'Unknown question'
      };
    });

    const totalQuestions = quiz.questions.length;
    // No score calculation until admin evaluation
    const scorePercentage = 0;
    const totalPoints = 0;
    const passed = false; // Will be determined during admin evaluation

    // Get current payment for reference
    const currentPayment = await prisma.dailyPayment.findFirst({
      where: {
        userId,
        status: 'completed',
        expiresAt: {
          gt: new Date()
        }
      },
      orderBy: {
        expiresAt: 'desc'
      }
    });

    // Create quiz attempt and answers in transaction
    const result = await executeCriticalTransaction(async (tx) => {
      let quizAttempt;

      if (isReattempt) {
        // Update existing attempt if it's a reattempt
        quizAttempt = await tx.quizAttempt.update({
          where: { id: existingAttempt.id },
          data: {
            completedAt: new Date(),
            isEvaluated: false, // Reset evaluation status for new questions
          },
        });
      } else {
        // Create new quiz attempt
        quizAttempt = await tx.quizAttempt.create({
          data: {
            userId,
            quizId,
            score: scorePercentage,
            points: totalPoints,
            isCompleted: true,
            isEvaluated: false, // Will be evaluated by admin later
            completedAt: new Date(),
            dailyPaymentId: currentPayment?.id,
          },
        });
      }

      // Create individual question attempts for tracking
      const questionAttemptRecords = answers.map(answer => ({
        userId,
        questionId: answer.questionId,
        quizId,
        selectedOption: answer.selectedOption,
        isCorrect: false, // Will be determined during admin evaluation
        attemptedAt: new Date(),
      }));

      await tx.questionAttempt.createMany({
        data: questionAttemptRecords,
      });

      // Create individual answers (without correctness evaluation)
      const answerRecords = answers.map(answer => ({
        userId,
        questionId: answer.questionId,
        selectedOption: answer.selectedOption,
        quizAttemptId: quizAttempt.id,
        isCorrect: false, // Will be determined during admin evaluation
      }));

      await tx.answer.createMany({
        data: answerRecords,
      });

      // Don't update user points until evaluation is complete
      // Points will be awarded during admin evaluation process

      return { quizAttempt, answerResults };
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
        score: null, // Score will be calculated after admin evaluation
        points: null, // Points will be awarded after admin evaluation
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