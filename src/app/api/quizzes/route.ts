import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { checkPaymentAccess } from '@/lib/payment-middleware';
import { getDb, quizDb, questionDb, generateId } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { createHash } from 'crypto';
import { securityLogger } from '@/lib/security-logger';
// User creation is now handled by database trigger

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

    // Support cache-busting for realtime re-fetches via ?fresh=1
    const url = new URL(request.url);
    const forceFresh = url.searchParams.get('fresh') === '1';

    const cacheKey = `quizzes_${userId}_${paymentAccess.hasAccess ? 'access' : 'noaccess'}`;
    if (!forceFresh) {
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
    }

    const supabase = await getDb();

    // Get all active quizzes
    const { data: quizzes, error: quizzesError } = await supabase
      .from('Quiz')
      .select('*')
      .eq('status', 'active')
      .order('createdAt', { ascending: false });

    if (quizzesError) throw quizzesError;

    // Batch fetch all related data instead of N+1 queries per quiz
    const quizIds = (quizzes || []).map((q: any) => q.id);

    // Fetch all questions for all quizzes at once
    const { data: allQuestions } = quizIds.length > 0
      ? await supabase
        .from('Question')
        .select('id, quizId, text, options')
        .in('quizId', quizIds)
        .eq('status', 'active')
      : { data: [] };

    // Fetch user's latest completed attempt per quiz
    const { data: allUserAttempts } = quizIds.length > 0
      ? await supabase
        .from('QuizAttempt')
        .select('id, quizId, score, completedAt')
        .in('quizId', quizIds)
        .eq('userId', userId)
        .eq('isCompleted', true)
        .order('completedAt', { ascending: false })
      : { data: [] };

    // Fetch user's question attempts for all quizzes at once
    const { data: allQuestionAttempts } = quizIds.length > 0
      ? await supabase
        .from('QuestionAttempt')
        .select('quizId, questionId')
        .in('quizId', quizIds)
        .eq('userId', userId)
      : { data: [] };

    // Fetch total attempt counts per quiz
    const { data: allAttemptCounts } = quizIds.length > 0
      ? await supabase
        .from('QuizAttempt')
        .select('quizId')
        .in('quizId', quizIds)
      : { data: [] };

    // Group data by quizId in-memory
    const questionsByQuiz = new Map<string, any[]>();
    for (const q of (allQuestions || [])) {
      if (!questionsByQuiz.has(q.quizId)) questionsByQuiz.set(q.quizId, []);
      questionsByQuiz.get(q.quizId)!.push(q);
    }

    // Get latest attempt per quiz (first one per quizId since ordered desc)
    const latestAttemptByQuiz = new Map<string, any>();
    for (const a of (allUserAttempts || [])) {
      if (!latestAttemptByQuiz.has(a.quizId)) {
        latestAttemptByQuiz.set(a.quizId, a);
      }
    }

    const questionAttemptsByQuiz = new Map<string, Set<string>>();
    for (const qa of (allQuestionAttempts || [])) {
      if (!questionAttemptsByQuiz.has(qa.quizId)) questionAttemptsByQuiz.set(qa.quizId, new Set());
      questionAttemptsByQuiz.get(qa.quizId)!.add(qa.questionId);
    }

    const attemptCountByQuiz = new Map<string, number>();
    for (const a of (allAttemptCounts || [])) {
      attemptCountByQuiz.set(a.quizId, (attemptCountByQuiz.get(a.quizId) || 0) + 1);
    }

    // Build enriched quiz objects
    const formattedQuizzes = (quizzes || []).map((quiz: any) => {
      const questions = questionsByQuiz.get(quiz.id) || [];
      const userAttempt = latestAttemptByQuiz.get(quiz.id);
      const attemptedQuestionIds = questionAttemptsByQuiz.get(quiz.id) || new Set();
      const totalQuestions = questions.length;
      const attemptedQuestionsCount = attemptedQuestionIds.size;
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
        totalAttempts: attemptCountByQuiz.get(quiz.id) || 0,
        hasAccess: paymentAccess.hasAccess,
        isCompleted,
        hasNewQuestions,
        newQuestionsCount: hasNewQuestions ? newQuestionsCount : 0,
        lastAttemptDate: userAttempt?.completedAt ? new Date(userAttempt.completedAt) : null,
        createdAt: new Date(quiz.createdAt),
        updatedAt: new Date(quiz.updatedAt),
        questions: paymentAccess.hasAccess
          ? questions.map((q: any) => ({
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

    const supabase = await getDb();

    // Create the quiz
    const quiz = await quizDb.create({
      title,
      description: description || null,
      duration,
      passingScore,
      status: 'active',
    });

    // Get counts for response
    const [questionsCount, attemptsCount] = await Promise.all([
      supabase.from('Question').select('*', { count: 'exact', head: true }).eq('quizId', quiz.id),
      supabase.from('QuizAttempt').select('*', { count: 'exact', head: true }).eq('quizId', quiz.id),
    ]);

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
        questionCount: questionsCount.count || 0,
        totalAttempts: attemptsCount.count || 0,
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
