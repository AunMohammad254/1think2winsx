import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { quizAttemptDb, answerDb, questionDb, getDb } from '@/lib/supabase/db';
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
    const supabase = await getDb();

    // Get attempt with quiz info
    const { data: quizAttempt, error: attemptError } = await supabase
      .from('QuizAttempt')
      .select(`
        id, userId, quizId, score, points, isCompleted, isEvaluated, completedAt,
        Quiz:quizId (id, title, description, duration, passingScore)
      `)
      .eq('userId', userId)
      .eq('quizId', quizId)
      .eq('isCompleted', true)
      .single();

    if (attemptError && attemptError.code !== 'PGRST116') {
      throw attemptError;
    }

    if (!quizAttempt) {
      return NextResponse.json(
        { error: 'Quiz results not found. You may not have completed this quiz yet.' },
        { status: 404 }
      );
    }

    // Get answers with question details
    const { data: answers, error: answersError } = await supabase
      .from('Answer')
      .select(`
        id, questionId, selectedOption, isCorrect,
        Question:questionId (id, text, options, correctOption)
      `)
      .eq('quizAttemptId', quizAttempt.id);

    if (answersError) throw answersError;

    // Format the results
    const answerDetails = (answers || []).map((answer: any) => {
      // Handle Supabase join - can return array or single object
      const questionRaw = answer.Question;
      const question = Array.isArray(questionRaw) ? questionRaw[0] : questionRaw;

      return {
        questionId: answer.questionId,
        questionText: question?.text || '',
        options: question?.options ? JSON.parse(question.options) : [],
        selectedOption: answer.selectedOption,
        correctOption: question?.correctOption,
        isCorrect: answer.isCorrect,
      };
    });

    const totalQuestions = answerDetails.length;
    const correctAnswers = answerDetails.filter((a: { isCorrect: boolean }) => a.isCorrect).length;
    // Handle Supabase join - can return array or single object
    const quizRaw = quizAttempt.Quiz;
    const quiz = Array.isArray(quizRaw) ? quizRaw[0] : quizRaw;
    const passed = quiz ? quizAttempt.score >= quiz.passingScore : false;

    recordSecurityEvent('QUIZ_RESULTS_VIEWED', request, userId, {
      quizId: quiz?.id,
      attemptId: quizAttempt.id,
    });

    return createSecureJsonResponse({
      quiz: quiz,
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