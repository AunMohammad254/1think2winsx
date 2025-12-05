import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import prisma from '@/lib/prisma';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';

// GET /api/quizzes/[id]/results - Get quiz results for user
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const authResult = await requireAuth({
      context: 'quiz_results',
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
      '/api/quizzes/[id]/results'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Get user's quiz attempt
    const quizAttempt = await prisma.quizAttempt.findFirst({
      where: {
        userId,
        quizId,
        isCompleted: true
      },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            description: true,
            duration: true,
            passingScore: true,
          }
        },
        answers: {
          include: {
            question: {
              select: {
                id: true,
                text: true,
                options: true,
                correctOption: true,
              }
            }
          }
        }
      }
    });

    if (!quizAttempt) {
      return NextResponse.json(
        { error: 'Quiz results not found. You may not have completed this quiz yet.' },
        { status: 404 }
      );
    }

    // Format the results
    const answerDetails = quizAttempt.answers.map(answer => ({
      questionId: answer.questionId,
      questionText: answer.question.text,
      options: JSON.parse(answer.question.options),
      selectedOption: answer.selectedOption,
      correctOption: answer.question.correctOption,
      isCorrect: answer.isCorrect,
    }));

    const totalQuestions = answerDetails.length;
    const correctAnswers = answerDetails.filter(a => a.isCorrect).length;
    const passed = quizAttempt.score >= quizAttempt.quiz.passingScore;

    recordSecurityEvent('QUIZ_RESULTS_VIEWED', request, userId, {
      quizId: quizAttempt.quiz.id,
      attemptId: quizAttempt.id,
    });

    return createSecureJsonResponse({
      quiz: quizAttempt.quiz,
      results: {
        attemptId: quizAttempt.id,
        score: quizAttempt.score,
        points: quizAttempt.points,
        correctAnswers,
        totalQuestions,
        passed,
        completedAt: quizAttempt.completedAt,
        isEvaluated: quizAttempt.isEvaluated,
        answers: answerDetails,
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Quiz results error:', error);
    recordSecurityEvent('QUIZ_RESULTS_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      quizId: id,
    });
    return NextResponse.json(
      { error: 'Failed to fetch quiz results' },
      { status: 500 }
    );
  }
}