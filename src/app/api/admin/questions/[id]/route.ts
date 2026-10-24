import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getAdminDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { clearQuizListCache } from '@/lib/quiz-cache';
import { adminName, logQuizAction } from '@/lib/admin-action-log';
import { answeredQuestionError, answeredQuestionIds, sameOptions } from '@/lib/question-guard';

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

    const supabase = getAdminDb();

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

    // The latest 20 answers, with who gave them
    const { data: answers } = await supabase
      .from('QuestionAttempt')
      .select(`
        id, selectedOption, isCorrect, createdAt,
        User:userId (id, name, email)
      `)
      .eq('questionId', questionId)
      .order('createdAt', { ascending: false })
      .limit(20);

    // Every answer counted: in total, correct, and per option (the distribution used to count only the
    // latest 20 answers while its percentages divided by the total)
    const options = JSON.parse(question.options);
    const countAnswers = async (filter: { selectedOption?: number; isCorrect?: true } = {}) => {
      let query = supabase.from('QuestionAttempt').select('*', { count: 'exact', head: true }).eq('questionId', questionId);
      if (filter.selectedOption !== undefined) query = query.eq('selectedOption', filter.selectedOption);
      if (filter.isCorrect) query = query.eq('isCorrect', true);
      const { count } = await query;
      return count || 0;
    };
    const [totalAnswers, correctAnswerCount, ...optionCounts] = await Promise.all([
      countAnswers(),
      countAnswers({ isCorrect: true }),
      ...options.map((_: string, index: number) => countAnswers({ selectedOption: index })),
    ]);
    const answerStats = options.map((option: string, index: number) => ({
      option: index,
      text: option,
      count: optionCounts[index],
      percentage: totalAnswers > 0 ? Math.round((optionCounts[index] / totalAnswers) * 100) : 0,
      isCorrect: question.correctOption === index,
    }));

    const correctAnswerRate = totalAnswers > 0 ? Math.round((correctAnswerCount / totalAnswers) * 100) : 0;

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
          const user = (Array.isArray(answer.User) ? answer.User[0] : answer.User) ?? null;
          return {
            id: answer.id,
            selectedOption: answer.selectedOption,
            isCorrect: answer.isCorrect,
            createdAt: answer.createdAt,
            user,
          };
        }),
        stats: {
          totalAnswers,
          correctAnswerCount,
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
        errors: validationResult.error.issues,
      });
      return NextResponse.json(
        { error: 'Invalid update data', details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const updateData = validationResult.data;
    const supabase = getAdminDb();

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

    // New options for a question players answered would re-map their answers (lib/question-guard)
    const optionsChanged = !!updateData.options && !sameOptions(existingQuestion.options, updateData.options);
    if (optionsChanged && (await answeredQuestionIds([questionId])).size > 0) {
      return NextResponse.json(
        { error: answeredQuestionError(existingQuestion.text), code: 'QUESTION_ANSWERED' },
        { status: 409 }
      );
    }

    // Prepare update data
    const finalUpdateData: QuestionUpdateData = {
      updatedAt: new Date().toISOString()
    };
    if (updateData.text) finalUpdateData.text = updateData.text;
    // Unchanged options are not rewritten: the database refuses any options write to an answered question
    if (optionsChanged) finalUpdateData.options = JSON.stringify(updateData.options);
    if (updateData.status) finalUpdateData.status = updateData.status;
    // The answer key only. Marking the question answered (hasCorrectAnswer) closes it to players, and
    // the result is saved, with the answers scored, in Settle Quizzes
    if (updateData.correctOption !== undefined) {
      finalUpdateData.correctOption = updateData.correctOption;
    }

    // Update question
    const { data: updatedQuestion, error: updateError } = await supabase
      .from('Question')
      .update(finalUpdateData)
      .eq('id', questionId)
      .select(`*, Quiz:quizId (id, title, status)`)
      .single();

    if (updateError) throw updateError;

    // Players see the change now, not when the shared quiz catalogue's cache runs out
    clearQuizListCache();
    await logQuizAction({
      quizId: updatedQuestion.quizId, action: 'question_edited', adminEmail: adminName(session.user),
      details: { questionId: updatedQuestion.id, changes: updateData },
    });
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

    const supabase = getAdminDb();

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

    // Deleting a question deletes every answer to it: refused once players answered it (lib/question-guard)
    if ((await answeredQuestionIds([questionId])).size > 0) {
      return NextResponse.json(
        { error: answeredQuestionError(existingQuestion.text), code: 'QUESTION_ANSWERED' },
        { status: 409 }
      );
    }

    // Delete question (it has no answers: checked above)
    const { error: deleteError } = await supabase
      .from('Question')
      .delete()
      .eq('id', questionId);

    if (deleteError) throw deleteError;

    // Players see the change now, not when the shared quiz catalogue's cache runs out
    clearQuizListCache();
    await logQuizAction({
      quizId: existingQuestion.quizId, action: 'question_deleted', adminEmail: adminName(session.user),
      details: { questionId: existingQuestion.id, text: existingQuestion.text },
    });
    recordSecurityEvent('SUSPICIOUS_ACTIVITY', request, session.user.id, {
      questionId: existingQuestion.id,
      quizId: existingQuestion.quizId,
      quizTitle: (Array.isArray(existingQuestion.Quiz) ? existingQuestion.Quiz[0] : existingQuestion.Quiz)?.title,
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