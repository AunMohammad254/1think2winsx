import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getDb, getAdminDb, quizDb, dailyPaymentDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { createHash } from 'crypto';
import { securityLogger } from '@/lib/security-logger';
import { getActiveQuizCatalog } from '@/lib/quiz-catalog';
import { quizListCache } from '@/lib/quiz-cache';

const createQuizSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  duration: z.number().min(1).max(180).default(30), // 1-180 minutes
  passingScore: z.number().min(0).max(100).default(70), // 0-100%
});

// Self-healing cron trigger (Hostinger has no scheduler). Previously fired an extra
// HTTP request back into this server on EVERY uncached quiz-list request, roughly
// doubling load. Now at most once per minute per process.
const CRON_KICK_INTERVAL_MS = 60_000;
let lastCronKick = 0;
function maybeKickCron() {
  const cronSecret = process.env.CRON_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
  const now = Date.now();
  if (!cronSecret || !siteUrl || now - lastCronKick < CRON_KICK_INTERVAL_MS) return;
  lastCronKick = now;
  fetch(`${siteUrl}/api/cron/process-scheduled`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cronSecret}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => { /* background safety net only */ });
}

/**
 * GET /api/quizzes - Active quizzes with the caller's access/progress status.
 *
 * PERFORMANCE (before -> after, per request):
 *   ~11 sequential Supabase calls (auth, 3x rate-limit table, payment, quizzes,
 *   questions, own attempts, question attempts, ALL attempts of every quiz, plus a
 *   self-HTTP cron call)  ->  auth + 3 parallel per-user queries; the shared
 *   catalogue (quizzes, questions, attempt counts) comes from a 15 s process cache.
 */
export async function GET(request: NextRequest) {
  try {
    const start = Date.now();
    const authResult = await requireAuth({ context: 'quiz_list' });
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.session.user.id;

    const rateLimitResponse = await applyRateLimit(rateLimiters.general, request, userId, '/api/quizzes');
    if (rateLimitResponse) return rateLimitResponse;

    const supabase = await getDb();
    const catalog = await getActiveQuizCatalog();
    const quizIds = catalog.map(q => q.id);

    const [payment, attemptsRes, questionAttemptsRes] = await Promise.all([
      dailyPaymentDb.findFirstActive(userId).catch(() => null),
      quizIds.length
        ? supabase.from('QuizAttempt').select('quizId, completedAt').eq('userId', userId).eq('isCompleted', true).in('quizId', quizIds)
        : Promise.resolve({ data: [] as Array<{ quizId: string; completedAt: string | null }> }),
      quizIds.length
        ? supabase.from('QuestionAttempt').select('quizId, questionId').eq('userId', userId).in('quizId', quizIds)
        : Promise.resolve({ data: [] as Array<{ quizId: string; questionId: string }> }),
    ]);

    const now = Date.now();
    const expiresAt = payment ? new Date(payment.expiresAt).getTime() : 0;
    const hasAccess = !!payment && expiresAt > now;
    const paymentInfo = hasAccess
      ? { id: payment!.id, expiresAt: new Date(expiresAt), timeRemaining: Math.floor((expiresAt - now) / 1000) }
      : null;

    const attemptByQuiz = new Map<string, { completedAt: string | null }>();
    for (const a of attemptsRes.data || []) attemptByQuiz.set(a.quizId, a);
    const answeredByQuiz = new Map<string, Set<string>>();
    for (const qa of questionAttemptsRes.data || []) {
      const set = answeredByQuiz.get(qa.quizId) || new Set<string>();
      set.add(qa.questionId);
      answeredByQuiz.set(qa.quizId, set);
    }

    const quizzes = catalog.map(quiz => {
      const attempt = attemptByQuiz.get(quiz.id);
      const answered = answeredByQuiz.get(quiz.id);
      const newQuestionsCount = quiz.questions.filter(q => !answered?.has(q.id)).length;
      const isCompleted = !!attempt;
      const hasNewQuestions = isCompleted && newQuestionsCount > 0;
      return {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        passingScore: quiz.passingScore,
        status: quiz.status,
        questionCount: quiz.questions.length,
        totalAttempts: quiz.totalAttempts,
        hasAccess,
        isCompleted,
        hasNewQuestions,
        newQuestionsCount: hasNewQuestions ? newQuestionsCount : 0,
        lastAttemptDate: attempt?.completedAt ? new Date(attempt.completedAt) : null,
        createdAt: new Date(quiz.createdAt),
        updatedAt: new Date(quiz.updatedAt),
        questions: hasAccess ? quiz.questions : [],
      };
    });

    const responseData = {
      quizzes,
      hasAccess,
      paymentInfo,
      accessError: hasAccess ? null : 'No active payment found. Please make a payment to access quizzes.',
    };

    securityLogger.logPerformanceMetric('quiz_list', Date.now() - start, '/api/quizzes');
    maybeKickCron();

    const etag = '"' + createHash('sha1').update(JSON.stringify(responseData)).digest('base64url') + '"';
    const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' };
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers });
    }
    return createSecureJsonResponse(responseData, { status: 200, headers });
  } catch (error) {
    console.error('Quiz list error:', error);
    recordSecurityEvent('QUIZ_LIST_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to fetch quizzes' }, { status: 500 });
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
        errors: validationResult.error.issues,
      });
      return NextResponse.json(
        { error: 'Invalid quiz data', details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { title, description, duration, passingScore } = validationResult.data;

    const supabase = getAdminDb();

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
