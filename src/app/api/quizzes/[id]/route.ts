import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { requirePaymentAccess } from '@/lib/payment-middleware';
import { quizDb, quizAttemptDb, questionAttemptDb } from '@/lib/supabase/db';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';

// GET /api/quizzes/[id] - Get quiz details and start attempt
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const authResult = await requireAuth({
      context: 'quiz_access',
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
      '/api/quizzes/[id]'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Check payment access
    const paymentAccessResponse = await requirePaymentAccess(userId, request);
    if (paymentAccessResponse) {
      return paymentAccessResponse;
    }

    // Get quiz with active questions
    const quiz = await quizDb.findByIdWithQuestions(quizId);

    if (!quiz || quiz.status !== 'active') {
      recordSecurityEvent('QUIZ_NOT_FOUND', request, userId, {
        quizId,
      });
      return NextResponse.json(
        { error: 'Quiz not found or inactive' },
        { status: 404 }
      );
    }

    // Filter active questions
    const activeQuestions = (quiz.questions || []).filter(
      (q: { status: string }) => q.status === 'active'
    );

    // Check if user has already completed this quiz
    const existingAttempt = await quizAttemptDb.findByUserAndQuiz(userId, quizId);
    const hasCompleted = existingAttempt?.isCompleted === true;

    // Get questions that the user has already attempted
    const attemptedQuestions = await questionAttemptDb.findByUserAndQuiz(userId, quizId);
    const attemptedQuestionIds = attemptedQuestions.map((qa: { questionId: string }) => qa.questionId);

    // Filter out questions that have already been attempted
    const unattemptedQuestions = activeQuestions.filter(
      (question: { id: string }) => !attemptedQuestionIds.includes(question.id)
    );

    // If user has completed the quiz but there are new questions, allow reattempt
    if (hasCompleted && unattemptedQuestions.length === 0) {
      return NextResponse.json(
        {
          error: 'You have already completed this quiz',
          completed: true,
          attempt: existingAttempt ? {
            id: existingAttempt.id,
            score: existingAttempt.score,
            points: existingAttempt.points,
            completedAt: existingAttempt.completedAt
          } : null
        },
        { status: 403 }
      );
    }

    // Determine which questions to show
    const questionsToShow = unattemptedQuestions.length > 0 ? unattemptedQuestions : activeQuestions;
    const isReattempt = hasCompleted && unattemptedQuestions.length > 0;

    // Format questions for frontend
    const formattedQuestions = questionsToShow.map((question: { id: string; text: string; options: string }) => ({
      id: question.id,
      text: question.text,
      options: JSON.parse(question.options),
    }));

    recordSecurityEvent('QUIZ_ACCESSED', request, userId, {
      quizId: quiz.id,
      title: quiz.title,
    });

    return createSecureJsonResponse({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        passingScore: quiz.passingScore,
        questionCount: formattedQuestions.length,
        totalQuestions: activeQuestions.length,
        questions: formattedQuestions,
        isReattempt,
        newQuestionsCount: isReattempt ? unattemptedQuestions.length : 0,
        previousAttempt: existingAttempt ? {
          id: existingAttempt.id,
          score: existingAttempt.score,
          points: existingAttempt.points,
          completedAt: existingAttempt.completedAt
        } : null
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Quiz access error:', error);
    recordSecurityEvent('QUIZ_ACCESS_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      quizId: id,
    });
    return NextResponse.json(
      { error: 'Failed to access quiz' },
      { status: 500 }
    );
  }
}