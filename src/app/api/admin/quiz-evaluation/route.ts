import { NextRequest, NextResponse } from 'next/server';
import { quizDb, questionDb, answerDb, quizAttemptDb, getDb } from '@/lib/supabase/db';
import { executeCriticalTransaction } from '@/lib/transaction-manager';
import { z } from 'zod';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { requireAuth } from '@/lib/auth-middleware';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { recordSecurityEvent } from '@/lib/security-monitoring';

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
    const supabase = await getDb();

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

    // Get unevaluated attempts with answers and user info
    const { data: attempts } = await supabase
      .from('QuizAttempt')
      .select(`
        id, userId, score, isEvaluated,
        User:userId (id, email, name)
      `)
      .eq('quizId', quizId)
      .eq('isEvaluated', false);

    // Process evaluation
    const evaluationResult = await executeCriticalTransaction(async () => {
      // 1. Set correct answers on all questions (sequential, small set)
      for (const [questionId, correctOption] of Object.entries(correctAnswers)) {
        await questionDb.setCorrectAnswer(questionId, correctOption as number);
      }

      const attemptList = attempts || [];
      console.log(`[QUIZ_EVALUATION] Starting evaluation for quiz ${quizId} with ${attemptList.length} attempts`);

      if (attemptList.length === 0) return [];

      // 2. Batch-fetch ALL answers for ALL unevaluated attempts in one query
      const attemptIds = attemptList.map((a: any) => a.id);
      const { data: allAnswerData } = await supabase
        .from('Answer')
        .select('id, questionId, selectedOption, quizAttemptId')
        .in('quizAttemptId', attemptIds);

      // Group answers by attemptId
      const answersByAttempt = new Map<string, any[]>();
      for (const ans of (allAnswerData || [])) {
        if (!answersByAttempt.has(ans.quizAttemptId)) answersByAttempt.set(ans.quizAttemptId, []);
        answersByAttempt.get(ans.quizAttemptId)!.push(ans);
      }

      // 3. Evaluate scores in-memory and collect correct/wrong answer IDs
      const correctAnswerIds: string[] = [];
      const wrongAnswerIds: string[] = [];
      const evaluatedAttempts = [];

      for (const attempt of attemptList) {
        const answerData = answersByAttempt.get(attempt.id) || [];
        let score = 0;
        const answerDetails = [];

        const userRaw = attempt.User;
        const user = Array.isArray(userRaw) ? userRaw[0] : userRaw;
        console.log(`[QUIZ_EVALUATION] Evaluating attempt ${attempt.id} for user ${user?.email}`);

        for (const answer of answerData) {
          const correctOption = correctAnswers[answer.questionId];
          const isCorrect = answer.selectedOption === correctOption;
          if (isCorrect) {
            score++;
            correctAnswerIds.push(answer.id);
          } else {
            wrongAnswerIds.push(answer.id);
          }
          answerDetails.push({ questionId: answer.questionId, selectedOption: answer.selectedOption, correctOption, isCorrect });
        }

        const scorePercentage = Math.round((score / questionIds.length) * 100);
        console.log(`[QUIZ_EVALUATION] User ${user?.email} scored ${score}/${questionIds.length} (${scorePercentage}%)`);

        await quizAttemptDb.update(attempt.id, { score: scorePercentage, isEvaluated: true });
        evaluatedAttempts.push({ userId: attempt.userId, userEmail: user?.email, score, totalQuestions: questionIds.length, percentage: scorePercentage });
      }

      // 4. Two bulk IN-clause updates instead of N×M sequential writes
      await Promise.all([
        correctAnswerIds.length > 0
          ? supabase.from('Answer').update({ isCorrect: true }).in('id', correctAnswerIds)
          : Promise.resolve(),
        wrongAnswerIds.length > 0
          ? supabase.from('Answer').update({ isCorrect: false }).in('id', wrongAnswerIds)
          : Promise.resolve(),
      ]);

      console.log(`[QUIZ_EVALUATION] Completed evaluation for ${evaluatedAttempts.length} attempts`);
      return evaluatedAttempts;
    }, {
      context: 'quiz_evaluation',
      userId: session.user.id,
      description: `Quiz evaluation for quiz ${quizId}`
    });

    return createSecureJsonResponse({
      success: true,
      message: 'Quiz evaluated successfully',
      evaluatedAttempts: evaluationResult.length,
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

    const supabase = await getDb();

    // Get quiz with evaluation status
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