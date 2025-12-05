import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import prisma from '@/lib/prisma';
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
  timeLimit: z.number().min(1).max(7200).optional(), // Max 2 hours in seconds
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

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quizzes/[id]'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Get quiz with all details
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: {
          select: {
            id: true,
            text: true,
            options: true,
            correctOption: true,
            hasCorrectAnswer: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: {
            createdAt: 'asc'
          }
        },
        attempts: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 10 // Latest 10 attempts
        },
        _count: {
          select: {
            questions: true,
            attempts: true
          }
        }
      }
    });

    if (!quiz) {
      return NextResponse.json(
        { error: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Calculate detailed stats
    const activeQuestions = quiz.questions.filter(q => q.status === 'active').length;
    const questionsWithAnswers = quiz.questions.filter(q => q.hasCorrectAnswer).length;
    
    const completedAttempts = await prisma.quizAttempt.count({
      where: {
        quizId,
        isCompleted: true
      }
    });

    const avgScoreResult = await prisma.quizAttempt.aggregate({
      where: {
        quizId,
        isCompleted: true
      },
      _avg: {
        score: true
      }
    });

    const highestScoreResult = await prisma.quizAttempt.findFirst({
      where: {
        quizId,
        isCompleted: true
      },
      orderBy: {
        score: 'desc'
      },
      include: {
        user: {
          select: {
            name: true,
            email: true
          }
        }
      }
    });

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
        questions: quiz.questions,
        recentAttempts: quiz.attempts,
        stats: {
          totalQuestions: quiz._count.questions,
          activeQuestions,
          questionsWithAnswers,
          totalAttempts: quiz._count.attempts,
          completedAttempts,
          completionRate: quiz._count.attempts > 0 ? Math.round((completedAttempts / quiz._count.attempts) * 100) : 0,
          averageScore: avgScoreResult._avg.score || 0,
          highestScore: highestScoreResult ? {
            score: highestScoreResult.score,
            user: highestScoreResult.user,
            completedAt: highestScoreResult.completedAt
          } : null,
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
    // Apply CSRF protection
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

    // Apply rate limiting for admin operations
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

    // Check if quiz exists
    const existingQuiz = await prisma.quiz.findUnique({
      where: { id: quizId }
    });

    if (!existingQuiz) {
      return NextResponse.json(
        { error: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Update quiz
    const updatedQuiz = await prisma.quiz.update({
      where: { id: quizId },
      data: updateData,
      include: {
        questions: {
          select: {
            id: true,
            text: true,
            options: true,
            correctOption: true,
            hasCorrectAnswer: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          }
        },
        _count: {
          select: {
            questions: true,
            attempts: true
          }
        }
      }
    });

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
        questions: updatedQuiz.questions,
        stats: {
          totalQuestions: updatedQuiz._count.questions,
          totalAttempts: updatedQuiz._count.attempts,
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
    // Apply CSRF protection
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

    // Apply rate limiting for admin operations
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

    // Check if quiz exists
    const existingQuiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: true
      }
    });

    if (!existingQuiz) {
      return NextResponse.json(
        { error: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Use transaction to update quiz and questions atomically
    const result = await prisma.$transaction(async (tx) => {
      // Update quiz basic info
      const quizUpdateData: {
        title: string;
        description?: string | null;
        status: string;
        duration?: number;
        passingScore?: number;
      } = {
        title: updateData.title,
        description: updateData.description,
        status: updateData.isActive ? 'active' : 'paused',
      };

      if (updateData.duration) {
        quizUpdateData.duration = updateData.duration;
      }
      if (updateData.passingScore) {
        quizUpdateData.passingScore = updateData.passingScore;
      }

      await tx.quiz.update({
        where: { id: quizId },
        data: quizUpdateData,
      });

      // Handle questions if provided
      if (updateData.questions && updateData.questions.length > 0) {
        // Get existing question IDs
        const existingQuestionIds = existingQuiz.questions.map(q => q.id);
        const updatedQuestionIds = updateData.questions
          .filter(q => q.id && !q.id.startsWith('temp-'))
          .map(q => q.id!);

        // Delete questions that are no longer in the update
        const questionsToDelete = existingQuestionIds.filter(id => !updatedQuestionIds.includes(id));
        if (questionsToDelete.length > 0) {
          await tx.question.deleteMany({
            where: {
              id: { in: questionsToDelete },
              quizId: quizId
            }
          });
        }

        // Update or create questions
        for (const questionData of updateData.questions) {
          const questionUpdateData = {
            text: questionData.text,
            options: JSON.stringify(questionData.options),
            correctOption: questionData.correctAnswer,
            hasCorrectAnswer: true,
            status: questionData.isActive !== false ? 'active' : 'paused',
          };

          if (questionData.id && !questionData.id.startsWith('temp-')) {
            // Update existing question
            await tx.question.update({
              where: { id: questionData.id },
              data: questionUpdateData,
            });
          } else {
            // Create new question
            await tx.question.create({
              data: {
                ...questionUpdateData,
                quizId: quizId,
              },
            });
          }
        }
      }

      // Return updated quiz with questions
      return await tx.quiz.findUnique({
        where: { id: quizId },
        include: {
          questions: {
            select: {
              id: true,
              text: true,
              options: true,
              correctOption: true,
              hasCorrectAnswer: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: {
              createdAt: 'asc'
            }
          },
          _count: {
            select: {
              questions: true,
              attempts: true
            }
          }
        }
      });
    });

    recordSecurityEvent('ADMIN_QUIZ_COMPLETE_UPDATE', request, session.user.id, {
      quizId: result!.id,
      title: result!.title,
      questionsCount: updateData.questions?.length || 0,
    });

    return createSecureJsonResponse({
      message: 'Quiz updated successfully',
      quiz: {
        id: result!.id,
        title: result!.title,
        description: result!.description,
        duration: result!.duration,
        passingScore: result!.passingScore,
        status: result!.status,
        createdAt: result!.createdAt,
        updatedAt: result!.updatedAt,
        questions: result!.questions,
        stats: {
          totalQuestions: result!._count.questions,
          totalAttempts: result!._count.attempts,
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
    // Apply CSRF protection
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

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quizzes/[id]'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Check if quiz exists
    const existingQuiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        title: true,
        _count: {
          select: {
            attempts: true
          }
        }
      }
    });

    if (!existingQuiz) {
      return NextResponse.json(
        { error: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Delete quiz (cascade will handle related records)
    await prisma.quiz.delete({
      where: { id: quizId }
    });

    recordSecurityEvent('ADMIN_QUIZ_DELETED', request, session.user.id, {
      quizId: existingQuiz.id,
      title: existingQuiz.title,
      attemptCount: existingQuiz._count.attempts,
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