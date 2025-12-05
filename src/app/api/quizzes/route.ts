import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { checkPaymentAccess } from '@/lib/payment-middleware';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { createHash } from 'crypto';
import { securityLogger } from '@/lib/security-logger';

const createQuizSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  duration: z.number().min(1).max(180).default(30), // 1-180 minutes
  passingScore: z.number().min(0).max(100).default(70), // 0-100%
});

interface PaymentInfo {
  id: string;
  expiresAt: Date;
  timeRemaining: number;
}

interface QuizListResponse {
  quizzes: Array<{
    id: string;
    title: string;
    description: string;
    duration: number;
    passingScore: number;
    status: string;
    questionCount: number;
    totalAttempts: number;
    hasAccess: boolean;
    isCompleted: boolean;
    hasNewQuestions: boolean;
    newQuestionsCount: number;
    lastAttemptDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
    questions: Array<{
      id: string;
      text: string;
      options: string[];
    }>;
  }>;
  hasAccess: boolean;
  paymentInfo: PaymentInfo | null;
  accessError: string | null;
}

// Simple in-memory cache for quiz list
const quizListCache = new Map<string, { data: QuizListResponse; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// GET /api/quizzes - Get all active quizzes with access status
export async function GET(request: NextRequest) {
  try {
    const start = Date.now();
    const authResult = await requireAuth({
      context: 'quiz_list',
    });
    
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    
    const { session } = authResult;
    const userId = session.user.id;
    
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.general,
      request,
      userId,
      '/api/quizzes'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const paymentAccess = await checkPaymentAccess(userId, request);

    const cacheKey = `quizzes_${userId}_${paymentAccess.hasAccess ? 'access' : 'noaccess'}`;
    const cached = quizListCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      const etag = createHash('sha1').update(JSON.stringify(cached.data)).digest('hex');
      const clientETag = request.headers.get('if-none-match');
      securityLogger.logPerformanceMetric('quiz_list_cache_hit', Date.now() - start, '/api/quizzes');
      if (clientETag === etag) {
        return new Response(null, { status: 304, headers: { 'ETag': etag, 'Cache-Control': 'private, max-age=30' } });
      }
      return createSecureJsonResponse(cached.data, { status: 200, headers: { 'ETag': etag, 'Cache-Control': 'private, max-age=30' } });
    }

    const quizzesWithQuestions = await prisma.quiz.findMany({
      where: { status: 'active' },
      include: {
        questions: {
          where: { status: 'active' },
          select: { id: true, text: true, options: true }
        },
        attempts: {
          where: { userId, isCompleted: true },
          select: { id: true, score: true, completedAt: true },
          orderBy: { completedAt: 'desc' },
          take: 1
        },
        questionAttempts: {
          where: { userId },
          select: { questionId: true }
        },
        _count: {
          select: {
            questions: { where: { status: 'active' } },
            attempts: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const quizzesWithoutQuestions = await prisma.quiz.findMany({
      where: { status: 'active' },
      include: {
        attempts: {
          where: { userId, isCompleted: true },
          select: { id: true, score: true, completedAt: true },
          orderBy: { completedAt: 'desc' },
          take: 1
        },
        questionAttempts: {
          where: { userId },
          select: { questionId: true }
        },
        _count: {
          select: {
            questions: { where: { status: 'active' } },
            attempts: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Format quizzes with access status and reattempt information
    const formattedQuizzes = (paymentAccess.hasAccess ? quizzesWithQuestions : quizzesWithoutQuestions).map(quiz => {
      const userAttempt = quiz.attempts[0]; // Most recent attempt
      const attemptedQuestionIds = quiz.questionAttempts.map(qa => qa.questionId);
      const totalQuestions = paymentAccess.hasAccess
        ? (quiz as typeof quizzesWithQuestions[number]).questions.length
        : quiz._count.questions;
      const attemptedQuestionsCount = attemptedQuestionIds.length;
      const newQuestionsCount = totalQuestions - attemptedQuestionsCount;
      
      const isCompleted = !!userAttempt;
      const hasNewQuestions = isCompleted && newQuestionsCount > 0;

      return {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description || '',
        duration: quiz.duration,
        passingScore: quiz.passingScore,
        status: quiz.status,
        questionCount: totalQuestions,
        totalAttempts: quiz._count.attempts,
        hasAccess: paymentAccess.hasAccess,
        isCompleted,
        hasNewQuestions,
        newQuestionsCount: hasNewQuestions ? newQuestionsCount : 0,
        lastAttemptDate: userAttempt?.completedAt || null,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt,
        questions: paymentAccess.hasAccess
          ? (quiz as typeof quizzesWithQuestions[number]).questions.map(q => ({
              id: q.id,
              text: q.text,
              options: JSON.parse(q.options),
            }))
          : []
      };
    });

    const responseData = {
      quizzes: formattedQuizzes,
      hasAccess: paymentAccess.hasAccess,
      paymentInfo: paymentAccess.payment || null,
      accessError: paymentAccess.error || null
    };

    quizListCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
    const etag = createHash('sha1').update(JSON.stringify(responseData)).digest('hex');
    const clientETag = request.headers.get('if-none-match');
    securityLogger.logPerformanceMetric('quiz_list', Date.now() - start, '/api/quizzes');
    if (clientETag === etag) {
      return new Response(null, { status: 304, headers: { 'ETag': etag, 'Cache-Control': 'private, max-age=30' } });
    }
    return createSecureJsonResponse(responseData, { status: 200, headers: { 'ETag': etag, 'Cache-Control': 'private, max-age=30' } });

  } catch (error) {
    console.error('Quiz list error:', error);
    recordSecurityEvent('QUIZ_LIST_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch quizzes' },
      { status: 500 }
    );
  }
}

// POST /api/quizzes - Create a new quiz (Admin only)
export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const authResult = await requireAuth({
      adminOnly: true,
      context: 'quiz_creation',
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
      '/api/quizzes'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/quizzes',
        rateLimiter: 'admin',
      });
      return rateLimitResponse;
    }

    const body = await request.json();
    const validationResult = createQuizSchema.safeParse(body);
    
    if (!validationResult.success) {
      recordSecurityEvent('INVALID_INPUT', request, session.user.id, {
        endpoint: '/api/quizzes',
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid quiz data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { title, description, duration, passingScore } = validationResult.data;

    const quiz = await prisma.quiz.create({
      data: {
        title,
        description,
        duration,
        passingScore,
        status: 'active',
      },
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

    // Clear cache
    quizListCache.clear();

    recordSecurityEvent('QUIZ_CREATED', request, session.user.id, {
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
        questionCount: quiz._count.questions,
        totalAttempts: quiz._count.attempts,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt,
      }
    }, { status: 201 });

  } catch (error) {
    console.error('Quiz creation error:', error);
    recordSecurityEvent('QUIZ_CREATION_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to create quiz' },
      { status: 500 }
    );
  }
}
