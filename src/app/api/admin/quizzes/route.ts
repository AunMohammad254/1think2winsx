import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';

const createQuizSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  duration: z.number().min(1).max(180).default(30),
  passingScore: z.number().min(0).max(100).default(70),
  timeLimit: z.number().min(1).max(3600).default(600),
  isActive: z.boolean().default(true),
  questions: z.array(z.object({
    text: z.string().min(1).max(1000),
    options: z.array(z.string()).min(2).max(6),
    correctAnswer: z.number().min(0),
    isActive: z.boolean().default(true),
  })).default([]),
});


interface QuizWhereClause {
  status?: string;
  OR?: Array<{
    title?: { contains: string; mode: 'insensitive' };
    description?: { contains: string; mode: 'insensitive' };
  }>;
}

// GET /api/admin/quizzes - Get all quizzes with admin details
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_quiz_list',
    });
    
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    
    const { session } = authResult;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quizzes'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/quizzes',
        rateLimiter: 'admin',
      });
      return rateLimitResponse;
    }

    // Parse query parameters
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
    const status = url.searchParams.get('status'); // 'active', 'paused', or null for all
    const search = url.searchParams.get('search');

    const skip = (page - 1) * limit;

    // Build where clause
    const where: QuizWhereClause = {};
    if (status) {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Get total count for pagination
    const totalCount = await prisma.quiz.count({ where });

    // Fetch quizzes with detailed stats
    const quizzes = await prisma.quiz.findMany({
      where,
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
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: limit,
    });

    // Calculate additional stats for each quiz
    const quizzesWithStats = await Promise.all(
      quizzes.map(async (quiz) => {
        const activeQuestions = quiz.questions.filter(q => q.status === 'active').length;
        const questionsWithAnswers = quiz.questions.filter(q => q.hasCorrectAnswer).length;
        
        // Get average score for this quiz
        const avgScoreResult = await prisma.quizAttempt.aggregate({
          where: {
            quizId: quiz.id,
            isCompleted: true
          },
          _avg: {
            score: true
          }
        });

        // Get completion rate
        const totalAttempts = quiz._count.attempts;
        const completedAttempts = await prisma.quizAttempt.count({
          where: {
            quizId: quiz.id,
            isCompleted: true
          }
        });

        return {
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          duration: quiz.duration,
          passingScore: quiz.passingScore,
          status: quiz.status,
          createdAt: quiz.createdAt,
          updatedAt: quiz.updatedAt,
          questions: quiz.questions,
          _count: {
            questions: quiz._count.questions,
            attempts: quiz._count.attempts
          },
          stats: {
            totalQuestions: quiz.questions.length,
            activeQuestions,
            questionsWithAnswers,
            totalAttempts,
            completedAttempts,
            completionRate: totalAttempts > 0 ? Math.round((completedAttempts / totalAttempts) * 100) : 0,
            averageScore: avgScoreResult._avg.score || 0,
          },
        };
      })
    );

    return createSecureJsonResponse({
      quizzes: quizzesWithStats,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNext: page * limit < totalCount,
        hasPrev: page > 1,
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Admin quiz list error:', error);
    recordSecurityEvent('ADMIN_QUIZ_LIST_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch quizzes' },
      { status: 500 }
    );
  }
}

// POST /api/admin/quizzes - Create a new quiz
export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_quiz_creation',
    });
    
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quizzes'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/quizzes',
        rateLimiter: 'admin',
      });
      return rateLimitResponse;
    }

    const body = await request.json();
    const validationResult = createQuizSchema.safeParse(body);
    
    if (!validationResult.success) {
      recordSecurityEvent('INVALID_INPUT', request, session.user.id, {
        endpoint: '/api/admin/quizzes',
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid quiz data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { title, description, duration, passingScore, timeLimit: _timeLimit, isActive, questions } = validationResult.data;

    // Create quiz with questions in a transaction
    const quiz = await prisma.$transaction(async (tx) => {
      // Create the quiz first
      const createdQuiz = await tx.quiz.create({
        data: {
          title,
          description,
          duration,
          passingScore,
          status: isActive ? 'active' : 'paused',
        },
      });

      // Create questions if provided
      if (questions && questions.length > 0) {
        await tx.question.createMany({
          data: questions.map((q, _index) => ({
            quizId: createdQuiz.id,
            text: q.text,
            options: JSON.stringify(q.options),
            correctOption: q.correctAnswer,
            hasCorrectAnswer: true,
            status: q.isActive ? 'active' : 'paused',
          })),
        });
      }

      // Return quiz with questions
      return await tx.quiz.findUnique({
        where: { id: createdQuiz.id },
        include: {
          questions: true,
          _count: {
            select: {
              questions: true,
              attempts: true
            }
          }
        }
      });
    });

    // Check if quiz creation was successful
    if (!quiz) {
      recordSecurityEvent('ADMIN_QUIZ_CREATION_ERROR', request, session.user.id, {
        error: 'Quiz creation failed - quiz not found after creation',
      });
      return NextResponse.json(
        { error: 'Failed to create quiz - quiz not found after creation' },
        { status: 500 }
      );
    }

    recordSecurityEvent('ADMIN_QUIZ_CREATED', request, session.user.id, {
      quizId: quiz.id,
      title: quiz.title,
    });

    return createSecureJsonResponse({
      message: 'Quiz created successfully',
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
        stats: {
          totalQuestions: quiz._count.questions || 0,
          activeQuestions: quiz.questions?.filter(q => q.status === 'active').length || 0,
          questionsWithAnswers: quiz.questions?.filter(q => q.hasCorrectAnswer).length || 0,
          totalAttempts: quiz._count.attempts || 0,
          completedAttempts: 0,
          completionRate: 0,
          averageScore: 0,
        },
      }
    }, { status: 201 });

  } catch (error) {
    console.error('Admin quiz creation error:', error);
    recordSecurityEvent('ADMIN_QUIZ_CREATION_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to create quiz' },
      { status: 500 }
    );
  }
}