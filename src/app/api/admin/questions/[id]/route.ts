import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import prisma from '@/lib/prisma';
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

    // Get question with details
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            status: true,
          }
        },
        answers: {
          include: {
            quizAttempt: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  }
                }
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 20 // Latest 20 answers
        },
        _count: {
          select: {
            answers: true
          }
        }
      }
    });

    if (!question) {
      return NextResponse.json(
        { error: 'Question not found' },
        { status: 404 }
      );
    }

    // Calculate answer statistics
    const options = JSON.parse(question.options);
    const answerStats = options.map((option: string, index: number) => {
      const count = question.answers.filter(answer => answer.selectedOption === index).length;
      const percentage = question._count.answers > 0 ? Math.round((count / question._count.answers) * 100) : 0;
      return {
        option: index,
        text: option,
        count,
        percentage,
        isCorrect: question.correctOption === index,
      };
    });

    const correctAnswerCount = question.answers.filter(answer => answer.isCorrect).length;
    const correctAnswerRate = question._count.answers > 0 ? Math.round((correctAnswerCount / question._count.answers) * 100) : 0;

    recordSecurityEvent('SUSPICIOUS_ACTIVITY', request, session.user.id, {
      questionId: question.id,
      quizId: question.quizId,
    });

    return createSecureJsonResponse({
      question: {
        id: question.id,
        quizId: question.quizId,
        quiz: question.quiz,
        text: question.text,
        options: JSON.parse(question.options),
        correctOption: question.correctOption,
        hasCorrectAnswer: question.hasCorrectAnswer,
        status: question.status,
        createdAt: question.createdAt,
        updatedAt: question.updatedAt,
        recentAnswers: question.answers.map(answer => ({
          id: answer.id,
          selectedOption: answer.selectedOption,
          isCorrect: answer.isCorrect,
          createdAt: answer.createdAt,
          user: answer.quizAttempt.user,
        })),
        stats: {
          totalAnswers: question._count.answers,
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
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid update data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const updateData = validationResult.data;

    // Check if question exists
    const existingQuestion = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
          }
        }
      }
    });

    if (!existingQuestion) {
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
    const finalUpdateData: QuestionUpdateData = {};
    if (updateData.text) finalUpdateData.text = updateData.text;
    if (updateData.options) finalUpdateData.options = JSON.stringify(updateData.options);
    if (updateData.status) finalUpdateData.status = updateData.status;
    if (updateData.correctOption !== undefined) {
      finalUpdateData.correctOption = updateData.correctOption;
      finalUpdateData.hasCorrectAnswer = true;
    }

    // Update question
    const updatedQuestion = await prisma.question.update({
      where: { id: questionId },
      data: finalUpdateData,
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            status: true,
          }
        }
      }
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
        quiz: updatedQuestion.quiz,
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

    // Check if question exists
    const existingQuestion = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
          }
        },
        _count: {
          select: {
            answers: true
          }
        }
      }
    });

    if (!existingQuestion) {
      return NextResponse.json(
        { error: 'Question not found' },
        { status: 404 }
      );
    }

    // Delete question (cascade will handle related answers)
    await prisma.question.delete({
      where: { id: questionId }
    });

    recordSecurityEvent('SUSPICIOUS_ACTIVITY', request, session.user.id, {
      questionId: existingQuestion.id,
      quizId: existingQuestion.quizId,
      quizTitle: existingQuestion.quiz.title,
      answerCount: existingQuestion._count.answers,
    });

    return createSecureJsonResponse({
      message: 'Question deleted successfully',
      deletedQuestion: {
        id: existingQuestion.id,
        text: existingQuestion.text,
        quiz: existingQuestion.quiz,
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