import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getDb, generateId } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';

const updateQuizSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  duration: z.number().min(1).max(180).optional(),
  passingScore: z.number().min(0).max(100).optional(),
  status: z.enum(['active', 'paused']).optional(),
  isActive: z.boolean().optional(),
});

// Schema for complete quiz update with questions (PUT method)
const completeQuizUpdateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  timeLimit: z.number().min(1).max(7200).optional(),
  duration: z.number().min(1).max(180).optional(),
  passingScore: z.number().min(0).max(100).optional(),
  status: z.enum(['active', 'paused']).optional(),
  isActive: z.boolean().optional(),
  questions: z.array(z.object({
    id: z.string().optional(),
    text: z.string().min(1).max(1000),
    options: z.array(z.string().min(1).max(500)).min(2).max(6),
    correctAnswer: z.number().min(0).max(5),
    isActive: z.boolean().optional(),
    order: z.number().optional(),
  })).optional(),
});

// GET /api/admin/quizzes/[id] - Get specific quiz with full details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_quiz_details',
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;
    const quizId = id;

    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quizzes/[id]'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const supabase = await getDb();

    // Get quiz
    const { data: quiz, error: quizError } = await supabase
      .from('Quiz')
      .select('*')
      .eq('id', quizId)
      .single();

    if (quizError || !quiz) {
      return NextResponse.json(
        { error: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Get questions
    const { data: questions } = await supabase
      .from('Question')
      .select('id, text, options, correctOption, hasCorrectAnswer, status, createdAt, updatedAt')
      .eq('quizId', quizId)
      .order('createdAt', { ascending: true });

    // Get recent attempts with users
    const { data: attempts } = await supabase
      .from('QuizAttempt')
      .select(`
        *,
        User:userId (id, name, email)
      `)
      .eq('quizId', quizId)
      .order('createdAt', { ascending: false })
      .limit(10);

    // Get counts
    const { count: questionCount } = await supabase
      .from('Question')
      .select('*', { count: 'exact', head: true })
      .eq('quizId', quizId);

    const { count: attemptCount } = await supabase
      .from('QuizAttempt')
      .select('*', { count: 'exact', head: true })
      .eq('quizId', quizId);

    const { count: completedAttempts } = await supabase
      .from('QuizAttempt')
      .select('*', { count: 'exact', head: true })
      .eq('quizId', quizId)
      .eq('isCompleted', true);

    // Calculate stats
    const activeQuestions = (questions || []).filter((q: any) => q.status === 'active').length;
    const questionsWithAnswers = (questions || []).filter((q: any) => q.hasCorrectAnswer).length;

    // Get average score
    const { data: scoreData } = await supabase
      .from('QuizAttempt')
      .select('score')
      .eq('quizId', quizId)
      .eq('isCompleted', true);

    const avgScore = scoreData && scoreData.length > 0
      ? scoreData.reduce((sum, a) => sum + a.score, 0) / scoreData.length
      : 0;

    // Get highest score
    const { data: highestScoreData } = await supabase
      .from('QuizAttempt')
      .select(`score, completedAt, User:userId (name, email)`)
      .eq('quizId', quizId)
      .eq('isCompleted', true)
      .order('score', { ascending: false })
      .limit(1);

    const highestScore = highestScoreData && highestScoreData.length > 0
      ? {
        score: highestScoreData[0].score,
        user: Array.isArray(highestScoreData[0].User)
          ? highestScoreData[0].User[0]
          : highestScoreData[0].User,
        completedAt: highestScoreData[0].completedAt
      }
      : null;

    recordSecurityEvent('ADMIN_QUIZ_VIEWED', request, session.user.id, {
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
        status: quiz.status,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt,
        questions: questions || [],
        recentAttempts: (attempts || []).map((a: any) => ({
          ...a,
          user: Array.isArray(a.User) ? a.User[0] : a.User
        })),
        stats: {
          totalQuestions: questionCount || 0,
          activeQuestions,
          questionsWithAnswers,
          totalAttempts: attemptCount || 0,
          completedAttempts: completedAttempts || 0,
          completionRate: attemptCount && attemptCount > 0
            ? Math.round(((completedAttempts || 0) / attemptCount) * 100)
            : 0,
          averageScore: Math.round(avgScore),
          highestScore,
        },
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Admin quiz details error:', error);
    recordSecurityEvent('ADMIN_QUIZ_DETAILS_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      quizId: id,
    });
    return NextResponse.json(
      { error: 'Failed to fetch quiz details' },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/quizzes/[id] - Update quiz
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_quiz_update',
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;
    const quizId = id;

    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quizzes/[id]'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/quizzes/[id]',
        rateLimiter: 'admin',
      });
      return rateLimitResponse;
    }

    const body = await request.json();
    const validationResult = updateQuizSchema.safeParse(body);

    if (!validationResult.success) {
      recordSecurityEvent('INVALID_INPUT', request, session.user.id, {
        endpoint: '/api/admin/quizzes/[id]',
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid update data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const updateData = validationResult.data;
    const supabase = await getDb();

    // Check if quiz exists
    const { data: existingQuiz, error: fetchError } = await supabase
      .from('Quiz')
      .select('id')
      .eq('id', quizId)
      .single();

    if (fetchError || !existingQuiz) {
      return NextResponse.json(
        { error: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Update quiz
    const { data: updatedQuiz, error: updateError } = await supabase
      .from('Quiz')
      .update({
        ...updateData,
        updatedAt: new Date().toISOString()
      })
      .eq('id', quizId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Get questions and counts
    const { data: questions } = await supabase
      .from('Question')
      .select('id, text, options, correctOption, hasCorrectAnswer, status, createdAt, updatedAt')
      .eq('quizId', quizId);

    const { count: attemptCount } = await supabase
      .from('QuizAttempt')
      .select('*', { count: 'exact', head: true })
      .eq('quizId', quizId);

    recordSecurityEvent('ADMIN_QUIZ_UPDATED', request, session.user.id, {
      quizId: updatedQuiz.id,
      title: updatedQuiz.title,
      changes: updateData,
    });

    return createSecureJsonResponse({
      message: 'Quiz updated successfully',
      quiz: {
        id: updatedQuiz.id,
        title: updatedQuiz.title,
        description: updatedQuiz.description,
        duration: updatedQuiz.duration,
        passingScore: updatedQuiz.passingScore,
        status: updatedQuiz.status,
        createdAt: updatedQuiz.createdAt,
        updatedAt: updatedQuiz.updatedAt,
        questions: questions || [],
        stats: {
          totalQuestions: (questions || []).length,
          totalAttempts: attemptCount || 0,
        },
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Admin quiz update error:', error);
    recordSecurityEvent('ADMIN_QUIZ_UPDATE_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      quizId: id,
    });
    return NextResponse.json(
      { error: 'Failed to update quiz' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/quizzes/[id] - Complete quiz update with questions
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_quiz_complete_update',
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;
    const quizId = id;

    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quizzes/[id]'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/quizzes/[id]',
        rateLimiter: 'admin',
      });
      return rateLimitResponse;
    }

    const body = await request.json();
    const validationResult = completeQuizUpdateSchema.safeParse(body);

    if (!validationResult.success) {
      recordSecurityEvent('INVALID_INPUT', request, session.user.id, {
        endpoint: '/api/admin/quizzes/[id]',
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid update data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const updateData = validationResult.data;
    const supabase = await getDb();

    // Check if quiz exists with questions
    const { data: existingQuiz, error: fetchError } = await supabase
      .from('Quiz')
      .select('id')
      .eq('id', quizId)
      .single();

    if (fetchError || !existingQuiz) {
      return NextResponse.json(
        { error: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Get existing questions
    const { data: existingQuestions } = await supabase
      .from('Question')
      .select('id')
      .eq('quizId', quizId);

    // Update quiz basic info
    const quizUpdateData: Record<string, any> = {
      title: updateData.title,
      description: updateData.description,
      status: updateData.isActive ? 'active' : 'paused',
      updatedAt: new Date().toISOString()
    };

    if (updateData.duration) quizUpdateData.duration = updateData.duration;
    if (updateData.passingScore) quizUpdateData.passingScore = updateData.passingScore;

    await supabase
      .from('Quiz')
      .update(quizUpdateData)
      .eq('id', quizId);

    // Handle questions if provided
    if (updateData.questions && updateData.questions.length > 0) {
      const existingQuestionIds = (existingQuestions || []).map(q => q.id);
      const updatedQuestionIds = updateData.questions
        .filter(q => q.id && !q.id.startsWith('temp-'))
        .map(q => q.id!);

      // Delete questions that are no longer in the update
      const questionsToDelete = existingQuestionIds.filter(id => !updatedQuestionIds.includes(id));
      if (questionsToDelete.length > 0) {
        // Delete answers first
        await supabase
          .from('Answer')
          .delete()
          .in('questionId', questionsToDelete);

        await supabase
          .from('Question')
          .delete()
          .in('id', questionsToDelete);
      }

      // Update or create questions
      for (const questionData of updateData.questions) {
        const questionUpdateData = {
          text: questionData.text,
          options: JSON.stringify(questionData.options),
          correctOption: questionData.correctAnswer,
          hasCorrectAnswer: true,
          status: questionData.isActive !== false ? 'active' : 'paused',
          updatedAt: new Date().toISOString()
        };

        if (questionData.id && !questionData.id.startsWith('temp-')) {
          // Update existing question
          await supabase
            .from('Question')
            .update(questionUpdateData)
            .eq('id', questionData.id);
        } else {
          // Create new question
          await supabase
            .from('Question')
            .insert({
              id: generateId(),
              quizId: quizId,
              ...questionUpdateData,
              createdAt: new Date().toISOString()
            });
        }
      }
    }

    // Fetch updated quiz with questions
    const { data: resultQuiz } = await supabase
      .from('Quiz')
      .select('*')
      .eq('id', quizId)
      .single();

    const { data: resultQuestions } = await supabase
      .from('Question')
      .select('id, text, options, correctOption, hasCorrectAnswer, status, createdAt, updatedAt')
      .eq('quizId', quizId)
      .order('createdAt', { ascending: true });

    const { count: attemptCount } = await supabase
      .from('QuizAttempt')
      .select('*', { count: 'exact', head: true })
      .eq('quizId', quizId);

    recordSecurityEvent('ADMIN_QUIZ_COMPLETE_UPDATE', request, session.user.id, {
      quizId: resultQuiz!.id,
      title: resultQuiz!.title,
      questionsCount: updateData.questions?.length || 0,
    });

    return createSecureJsonResponse({
      message: 'Quiz updated successfully',
      quiz: {
        id: resultQuiz!.id,
        title: resultQuiz!.title,
        description: resultQuiz!.description,
        duration: resultQuiz!.duration,
        passingScore: resultQuiz!.passingScore,
        status: resultQuiz!.status,
        createdAt: resultQuiz!.createdAt,
        updatedAt: resultQuiz!.updatedAt,
        questions: resultQuestions || [],
        stats: {
          totalQuestions: (resultQuestions || []).length,
          totalAttempts: attemptCount || 0,
        },
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Admin quiz complete update error:', error);
    recordSecurityEvent('ADMIN_QUIZ_COMPLETE_UPDATE_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      quizId: id,
    });
    return NextResponse.json(
      { error: 'Failed to update quiz' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/quizzes/[id] - Delete quiz
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_quiz_deletion',
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;
    const quizId = id;

    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quizzes/[id]'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const supabase = await getDb();

    // Check if quiz exists
    const { data: existingQuiz, error: fetchError } = await supabase
      .from('Quiz')
      .select('id, title')
      .eq('id', quizId)
      .single();

    if (fetchError || !existingQuiz) {
      return NextResponse.json(
        { error: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Get attempt count
    const { count: attemptCount } = await supabase
      .from('QuizAttempt')
      .select('*', { count: 'exact', head: true })
      .eq('quizId', quizId);

    // Delete in order: Answers -> QuestionAttempts -> Questions -> QuizAttempts -> Winnings -> Quiz
    const { data: questions } = await supabase
      .from('Question')
      .select('id')
      .eq('quizId', quizId);

    if (questions && questions.length > 0) {
      const questionIds = questions.map(q => q.id);
      await supabase.from('Answer').delete().in('questionId', questionIds);
      await supabase.from('QuestionAttempt').delete().in('questionId', questionIds);
    }

    await supabase.from('Question').delete().eq('quizId', quizId);

    const { data: attempts } = await supabase
      .from('QuizAttempt')
      .select('id')
      .eq('quizId', quizId);

    if (attempts && attempts.length > 0) {
      const attemptIds = attempts.map(a => a.id);
      await supabase.from('Answer').delete().in('quizAttemptId', attemptIds);
      await supabase.from('QuestionAttempt').delete().in('quizAttemptId', attemptIds);
    }

    await supabase.from('QuizAttempt').delete().eq('quizId', quizId);
    await supabase.from('Winning').delete().eq('quizId', quizId);

    // Delete quiz
    const { error: deleteError } = await supabase
      .from('Quiz')
      .delete()
      .eq('id', quizId);

    if (deleteError) throw deleteError;

    recordSecurityEvent('ADMIN_QUIZ_DELETED', request, session.user.id, {
      quizId: existingQuiz.id,
      title: existingQuiz.title,
      attemptCount: attemptCount || 0,
    });

    return createSecureJsonResponse({
      message: 'Quiz deleted successfully',
      deletedQuiz: {
        id: existingQuiz.id,
        title: existingQuiz.title,
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Admin quiz deletion error:', error);
    recordSecurityEvent('ADMIN_QUIZ_DELETION_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      quizId: id,
    });
    return NextResponse.json(
      { error: 'Failed to delete quiz' },
      { status: 500 }
    );
  }
}