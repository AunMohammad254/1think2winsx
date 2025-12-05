import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { Prisma } from '@prisma/client';

const createQuestionSchema = z.object({
  quizId: z.string(),
  text: z.string().min(1).max(1000),
  options: z.array(z.string()).min(2).max(6),
  correctOption: z.number().min(0).nullable().optional(),
});

// POST /api/admin/questions - Create a new question
export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_question_creation',
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
      '/api/admin/questions'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/questions',
        rateLimiter: 'admin',
      });
      return rateLimitResponse;
    }

    const body = await request.json();
    const validationResult = createQuestionSchema.safeParse(body);
    
    if (!validationResult.success) {
      recordSecurityEvent('INVALID_INPUT', request, session.user.id, {
        endpoint: '/api/admin/questions',
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid question data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { quizId, text, options, correctOption } = validationResult.data;

    // Verify quiz exists
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: { id: true, title: true }
    });

    if (!quiz) {
      return NextResponse.json(
        { error: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Validate correctOption if provided
    if (correctOption !== undefined && correctOption !== null && (correctOption < 0 || correctOption >= options.length)) {
      return NextResponse.json(
        { error: 'Invalid correct option index' },
        { status: 400 }
      );
    }

    const question = await prisma.question.create({
      data: {
        quizId,
        text,
        options: JSON.stringify(options),
        correctOption: correctOption !== null ? correctOption : null,
        hasCorrectAnswer: correctOption !== undefined && correctOption !== null,
        status: 'active',
      },
    });

    recordSecurityEvent('ADMIN_QUESTION_CREATED', request, session.user.id, {
      questionId: question.id,
      quizId: quiz.id,
      quizTitle: quiz.title,
    });

    return createSecureJsonResponse({
      message: 'Question created successfully',
      question: {
        id: question.id,
        quizId: question.quizId,
        text: question.text,
        options: JSON.parse(question.options),
        correctOption: question.correctOption,
        hasCorrectAnswer: question.hasCorrectAnswer,
        status: question.status,
        createdAt: question.createdAt,
        updatedAt: question.updatedAt,
      }
    }, { status: 201 });

  } catch (error) {
    console.error('Admin question creation error:', error);
    recordSecurityEvent('ADMIN_QUESTION_CREATION_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to create question' },
      { status: 500 }
    );
  }
}

// GET /api/admin/questions - Get questions with filters
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth({
      adminOnly: true,
      context: 'admin_question_list',
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
      '/api/admin/questions'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Parse query parameters
    const url = new URL(request.url);
    const quizId = url.searchParams.get('quizId');
    const status = url.searchParams.get('status');
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

    const skip = (page - 1) * limit;

    // Build where clause with proper typing
    const where: Prisma.QuestionWhereInput = {};
    if (quizId) {
      where.quizId = quizId;
    }
    if (status) {
      where.status = status;
    }

    // Get total count for pagination
    const totalCount = await prisma.question.count({ where });

    // Fetch questions
    const questions = await prisma.question.findMany({
      where,
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            status: true,
          }
        },
        _count: {
          select: {
            answers: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: limit,
    });

    const formattedQuestions = questions.map(question => ({
      id: question.id,
      quizId: question.quizId,
      quiz: question.quiz,
      text: question.text,
      options: JSON.parse(question.options),
      correctOption: question.correctOption,
      hasCorrectAnswer: question.hasCorrectAnswer,
      status: question.status,
      answerCount: question._count.answers,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
    }));

    return createSecureJsonResponse({
      questions: formattedQuestions,
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
    console.error('Admin question list error:', error);
    recordSecurityEvent('ADMIN_QUESTION_LIST_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch questions' },
      { status: 500 }
    );
  }
}