import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';

const updateQuestionSchema = z.object({
  text: z.string().min(1).max(1000).optional(),
  options: z.array(z.string()).min(2).max(6).optional(),
  correctOption: z.number().min(0).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

interface QuestionUpdateData {
  text?: string;
  options?: string;
  status?: string;
  correctOption?: number;
  hasCorrectAnswer?: boolean;
  updatedAt?: string;
}

// GET /api/admin/questions/[id] - Get specific question details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_question_details',
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;
    const questionId = id;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/questions/[id]'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const supabase = await getDb();

    // Get question with quiz details
    const { data: question, error: questionError } = await supabase
      .from('Question')
      .select(`
        *,
        Quiz:quizId (id, title, status)
      `)
      .eq('id', questionId)
      .single();

    if (questionError || !question) {
      return NextResponse.json(
        { error: 'Question not found' },
        { status: 404 }
      );
    }

    // Get answers for this question (last 20)
    const { data: answers } = await supabase
      .from('Answer')
      .select(`
        id, selectedOption, isCorrect, createdAt,
        QuizAttempt:quizAttemptId (
          User:userId (id, name, email)
        )
      `)
      .eq('questionId', questionId)
      .order('createdAt', { ascending: false })
      .limit(20);

    // Get total answer count
    const { count: totalAnswers } = await supabase
      .from('Answer')
      .select('*', { count: 'exact', head: true })
      .eq('questionId', questionId);

    // Calculate answer statistics
    const options = JSON.parse(question.options);
    const answerStats = options.map((option: string, index: number) => {
      const count = (answers || []).filter((answer: any) => answer.selectedOption === index).length;
      const percentage = totalAnswers && totalAnswers > 0 ? Math.round((count / totalAnswers) * 100) : 0;
      return {
        option: index,
        text: option,
        count,
        percentage,
        isCorrect: question.correctOption === index,
      };
    });

    // Count correct answers
    const { count: correctAnswerCount } = await supabase
      .from('Answer')
      .select('*', { count: 'exact', head: true })
      .eq('questionId', questionId)
      .eq('isCorrect', true);

    const correctAnswerRate = totalAnswers && totalAnswers > 0
      ? Math.round(((correctAnswerCount || 0) / totalAnswers) * 100)
      : 0;

    recordSecurityEvent('SUSPICIOUS_ACTIVITY', request, session.user.id, {
      questionId: question.id,
      quizId: question.quizId,
    });

    return createSecureJsonResponse({
      question: {
        id: question.id,
        quizId: question.quizId,
        quiz: Array.isArray(question.Quiz) ? question.Quiz[0] : question.Quiz,
        text: question.text,
        options: JSON.parse(question.options),
        correctOption: question.correctOption,
        hasCorrectAnswer: question.hasCorrectAnswer,
        status: question.status,
        createdAt: question.createdAt,
        updatedAt: question.updatedAt,
        recentAnswers: (answers || []).map((answer: any) => {
          const attempt = Array.isArray(answer.QuizAttempt) ? answer.QuizAttempt[0] : answer.QuizAttempt;
          const user = attempt ? (Array.isArray(attempt.User) ? attempt.User[0] : attempt.User) : null;
          return {
            id: answer.id,
            selectedOption: answer.selectedOption,
            isCorrect: answer.isCorrect,
            createdAt: answer.createdAt,
            user,
          };
        }),
        stats: {
          totalAnswers: totalAnswers || 0,
          correctAnswerCount: correctAnswerCount || 0,
          correctAnswerRate,
          answerDistribution: answerStats,
        },
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Admin question details error:', error);
    recordSecurityEvent('UNAUTHORIZED_ACCESS', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      questionId: id,
    });
    return NextResponse.json(
      { error: 'Failed to fetch question details' },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/questions/[id] - Update question
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_question_update',
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;
    const questionId = id;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/questions/[id]'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/questions/[id]',
        rateLimiter: 'admin',
      });
      return rateLimitResponse;
    }

    const body = await request.json();
    const validationResult = updateQuestionSchema.safeParse(body);

    if (!validationResult.success) {
      recordSecurityEvent('INVALID_INPUT', request, session.user.id, {
        endpoint: '/api/admin/questions/[id]',
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid update data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const updateData = validationResult.data;
    const supabase = await getDb();

    // Check if question exists
    const { data: existingQuestion, error: fetchError } = await supabase
      .from('Question')
      .select(`*, Quiz:quizId (id, title)`)
      .eq('id', questionId)
      .single();

    if (fetchError || !existingQuestion) {
      return NextResponse.json(
        { error: 'Question not found' },
        { status: 404 }
      );
    }

    // Validate correctOption if provided
    if (updateData.correctOption !== undefined && updateData.options) {
      if (updateData.correctOption < 0 || updateData.correctOption >= updateData.options.length) {
        return NextResponse.json(
          { error: 'Invalid correct option index' },
          { status: 400 }
        );
      }
    } else if (updateData.correctOption !== undefined) {
      const currentOptions = JSON.parse(existingQuestion.options);
      if (updateData.correctOption < 0 || updateData.correctOption >= currentOptions.length) {
        return NextResponse.json(
          { error: 'Invalid correct option index for current options' },
          { status: 400 }
        );
      }
    }

    // Prepare update data
    const finalUpdateData: QuestionUpdateData = {
      updatedAt: new Date().toISOString()
    };
    if (updateData.text) finalUpdateData.text = updateData.text;
    if (updateData.options) finalUpdateData.options = JSON.stringify(updateData.options);
    if (updateData.status) finalUpdateData.status = updateData.status;
    if (updateData.correctOption !== undefined) {
      finalUpdateData.correctOption = updateData.correctOption;
      finalUpdateData.hasCorrectAnswer = true;
    }

    // Update question
    const { data: updatedQuestion, error: updateError } = await supabase
      .from('Question')
      .update(finalUpdateData)
      .eq('id', questionId)
      .select(`*, Quiz:quizId (id, title, status)`)
      .single();

    if (updateError) throw updateError;

    recordSecurityEvent('SUSPICIOUS_ACTIVITY', request, session.user.id, {
      questionId: updatedQuestion.id,
      quizId: updatedQuestion.quizId,
      changes: updateData,
    });

    return createSecureJsonResponse({
      message: 'Question updated successfully',
      question: {
        id: updatedQuestion.id,
        quizId: updatedQuestion.quizId,
        quiz: Array.isArray(updatedQuestion.Quiz) ? updatedQuestion.Quiz[0] : updatedQuestion.Quiz,
        text: updatedQuestion.text,
        options: JSON.parse(updatedQuestion.options),
        correctOption: updatedQuestion.correctOption,
        hasCorrectAnswer: updatedQuestion.hasCorrectAnswer,
        status: updatedQuestion.status,
        createdAt: updatedQuestion.createdAt,
        updatedAt: updatedQuestion.updatedAt,
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Admin question update error:', error);
    recordSecurityEvent('UNAUTHORIZED_ACCESS', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      questionId: id,
    });
    return NextResponse.json(
      { error: 'Failed to update question' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/questions/[id] - Delete question
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_question_delete',
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;
    const questionId = id;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/questions/[id]'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const supabase = await getDb();

    // Check if question exists
    const { data: existingQuestion, error: fetchError } = await supabase
      .from('Question')
      .select(`*, Quiz:quizId (id, title)`)
      .eq('id', questionId)
      .single();

    if (fetchError || !existingQuestion) {
      return NextResponse.json(
        { error: 'Question not found' },
        { status: 404 }
      );
    }

    // Get answer count
    const { count: answerCount } = await supabase
      .from('Answer')
      .select('*', { count: 'exact', head: true })
      .eq('questionId', questionId);

    // Delete answers first (cascade)
    await supabase
      .from('Answer')
      .delete()
      .eq('questionId', questionId);

    // Delete question
    const { error: deleteError } = await supabase
      .from('Question')
      .delete()
      .eq('id', questionId);

    if (deleteError) throw deleteError;

    recordSecurityEvent('SUSPICIOUS_ACTIVITY', request, session.user.id, {
      questionId: existingQuestion.id,
      quizId: existingQuestion.quizId,
      quizTitle: (Array.isArray(existingQuestion.Quiz) ? existingQuestion.Quiz[0] : existingQuestion.Quiz)?.title,
      answerCount: answerCount || 0,
    });

    return createSecureJsonResponse({
      message: 'Question deleted successfully',
      deletedQuestion: {
        id: existingQuestion.id,
        text: existingQuestion.text,
        quiz: Array.isArray(existingQuestion.Quiz) ? existingQuestion.Quiz[0] : existingQuestion.Quiz,
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Admin question deletion error:', error);
    recordSecurityEvent('UNAUTHORIZED_ACCESS', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      questionId: id,
    });
    return NextResponse.json(
      { error: 'Failed to delete question' },
      { status: 500 }
    );
  }
}