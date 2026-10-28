import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getAdminDb, generateId, fetchAllByKeyset } from '@/lib/supabase/db';
import { z } from 'zod';
import { toUtcIso } from '@/lib/schedule-time';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { clearQuizListCache } from '@/lib/quiz-cache';
import { adminName, logQuizAction } from '@/lib/admin-action-log';

const createQuizSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  duration: z.number().min(1).max(180).default(30),
  passingScore: z.number().min(0).max(100).default(70),
  timeLimit: z.number().min(1).max(3600).default(600),
  status: z.enum(['active', 'paused', 'scheduled', 'draft']).optional(),
  startsAt: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  questions: z.array(z.object({
    text: z.string().min(1).max(1000),
    options: z.array(z.string()).min(2).max(6),
    correctAnswer: z.number().min(0),
    isActive: z.boolean().default(true),
  })).default([]),
});

// The newest quizzes the admin list shows (the Settle screen reads as many)
const SUMMARY_LIMIT = 500;

/**
 * The admin quiz list (?view=summary): the newest quizzes with their question and attempt counts, in
 * three light reads. The paged view sends 10 quizzes with every question's text and counts attempts
 * from their rows, which PostgREST cuts off at 1,000; the list then showed only those 10 quizzes.
 */
async function quizSummaries(supabase: ReturnType<typeof getAdminDb>) {
  const [{ data, error }, matches] = await Promise.all([
    supabase
      .from('Quiz')
      .select('id, title, description, duration, status, startsAt, pushedAt, quizType, createdAt, updatedAt')
      .order('createdAt', { ascending: false })
      .limit(SUMMARY_LIMIT),
    supabase.from('LiveMatch').select('quizId'),
  ]);
  if (error) throw error;
  // A match's quiz is run from Live Matches: published from this list, it would reach players before the
  // match is live. Without the match migration there are no matches, and the list still loads.
  if (matches.error) console.error('[admin-quizzes] Could not read the matches:', matches.error);
  const matchQuizzes = new Set(((matches.data || []) as Array<{ quizId: string }>).map((m) => m.quizId));
  const quizzes = ((data || []) as Array<{ id: string } & Record<string, unknown>>).filter((quiz) => !matchQuizzes.has(quiz.id));
  if (quizzes.length === 0) return [];

  const ids = quizzes.map((q) => q.id);
  const [questions, attempts] = await Promise.all([
    fetchAllByKeyset<{ id: string; quizId: string }>(
      (after, limit) => {
        let q = supabase.from('Question').select('id, quizId').in('quizId', ids);
        if (after) q = q.gt('id', after);
        return q.order('id', { ascending: true }).limit(limit);
      },
      (row) => row.id,
    ),
    supabase.rpc('get_quiz_attempt_counts_by_quiz', { quiz_ids: ids }),
  ]);
  if (attempts.error) throw attempts.error;

  const questionCounts = new Map<string, number>();
  for (const q of questions) questionCounts.set(q.quizId, (questionCounts.get(q.quizId) || 0) + 1);
  const attemptCounts = new Map(((attempts.data || []) as Array<{ quiz_id: string; attempt_count: number | string }>)
    .map((row) => [row.quiz_id, Number(row.attempt_count) || 0]));
  return quizzes.map((quiz) => ({
    ...quiz,
    _count: { questions: questionCounts.get(quiz.id) || 0, attempts: attemptCounts.get(quiz.id) || 0 },
  }));
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
    if (url.searchParams.get('view') === 'summary') {
      return createSecureJsonResponse({ quizzes: await quizSummaries(getAdminDb()) }, { status: 200 });
    }
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search');

    const offset = (page - 1) * limit;
    const supabase = getAdminDb();

    // Build base query
    let query = supabase
      .from('Quiz')
      .select('*', { count: 'exact' })
      .order('createdAt', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data: quizzes, count: totalCount, error } = await query;

    if (error) throw error;

    // Batch fetch all related data in 2 queries instead of 4×N
    const quizIds = (quizzes || []).map((q: any) => q.id);

    // Fetch all questions for all quizzes at once
    const { data: allQuestions } = quizIds.length > 0
      ? await supabase
        .from('Question')
        .select('id, quizId, text, options, correctOption, hasCorrectAnswer, status, createdAt, updatedAt')
        .in('quizId', quizIds)
      : { data: [] };

    // Fetch all attempts for all quizzes at once
    const { data: allAttempts } = quizIds.length > 0
      ? await supabase
        .from('QuizAttempt')
        .select('quizId, isCompleted, score')
        .in('quizId', quizIds)
      : { data: [] };

    // Group data by quizId in-memory
    const questionsByQuiz = new Map<string, any[]>();
    for (const q of (allQuestions || [])) {
      if (!questionsByQuiz.has(q.quizId)) questionsByQuiz.set(q.quizId, []);
      questionsByQuiz.get(q.quizId)!.push(q);
    }

    const attemptsByQuiz = new Map<string, any[]>();
    for (const a of (allAttempts || [])) {
      if (!attemptsByQuiz.has(a.quizId)) attemptsByQuiz.set(a.quizId, []);
      attemptsByQuiz.get(a.quizId)!.push(a);
    }

    // Build enriched quiz objects
    const quizzesWithStats = (quizzes || []).map((quiz: any) => {
      const questions = questionsByQuiz.get(quiz.id) || [];
      const attempts = attemptsByQuiz.get(quiz.id) || [];

      const totalAttempts = attempts.length;
      const completedAttempts = attempts.filter((a: any) => a.isCompleted).length;
      const completedScores = attempts.filter((a: any) => a.isCompleted).map((a: any) => a.score);
      const avgScore = completedScores.length > 0
        ? completedScores.reduce((sum: number, s: number) => sum + s, 0) / completedScores.length
        : 0;

      const activeQuestions = questions.filter((q: any) => q.status === 'active').length;
      const questionsWithAnswers = questions.filter((q: any) => q.hasCorrectAnswer).length;

      return {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        passingScore: quiz.passingScore,
        status: quiz.status,
        startsAt: quiz.startsAt,
        quizType: quiz.quizType,
        prizeId: quiz.prizeId,
        isBumperPrize: quiz.isBumperPrize,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt,
        questions: questions,
        _count: {
          questions: questions.length,
          attempts: totalAttempts,
        },
        stats: {
          totalQuestions: questions.length,
          activeQuestions,
          questionsWithAnswers,
          totalAttempts,
          completedAttempts,
          completionRate: totalAttempts > 0
            ? Math.round((completedAttempts / totalAttempts) * 100)
            : 0,
          averageScore: Math.round(avgScore),
        },
      };
    });

    return createSecureJsonResponse({
      quizzes: quizzesWithStats,
      pagination: {
        page,
        limit,
        totalCount: totalCount || 0,
        totalPages: Math.ceil((totalCount || 0) / limit),
        hasNext: page * limit < (totalCount || 0),
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
        errors: validationResult.error.issues,
      });
      return NextResponse.json(
        { error: 'Invalid quiz data', details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { title, description, duration, passingScore, status, startsAt, isActive, questions } = validationResult.data;
    const supabase = getAdminDb();

    // Create quiz
    const quizId = generateId();
    const { data: createdQuiz, error: quizError } = await supabase
      .from('Quiz')
      .insert({
        id: quizId,
        title,
        description,
        duration,
        passingScore,
        status: status || (isActive ? 'active' : 'paused'),
        startsAt: toUtcIso(startsAt),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (quizError) throw quizError;

    // Create questions if provided
    let createdQuestions: any[] = [];
    if (questions && questions.length > 0) {
      const questionData = questions.map((q) => ({
        id: generateId(),
        quizId: quizId,
        text: q.text,
        options: JSON.stringify(q.options),
        correctOption: q.correctAnswer,
        // The answer key only: a question with a saved result is closed to answers (Settle Quizzes saves it)
        hasCorrectAnswer: false,
        status: q.isActive ? 'active' : 'paused',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const { data: insertedQuestions, error: questionError } = await supabase
        .from('Question')
        .insert(questionData)
        .select();

      if (questionError) throw questionError;
      createdQuestions = insertedQuestions || [];
    }

    // Players see the change now, not when the shared quiz catalogue's cache runs out
    clearQuizListCache();
    await logQuizAction({
      quizId: createdQuiz.id, quizTitle: createdQuiz.title, action: 'quiz_created', adminEmail: adminName(session.user),
      details: { questions: createdQuestions.length },
    });
    recordSecurityEvent('ADMIN_QUIZ_CREATED', request, session.user.id, {
      quizId: createdQuiz.id,
      title: createdQuiz.title,
    });

    return createSecureJsonResponse({
      message: 'Quiz created successfully',
      quiz: {
        id: createdQuiz.id,
        title: createdQuiz.title,
        description: createdQuiz.description,
        duration: createdQuiz.duration,
        passingScore: createdQuiz.passingScore,
        status: createdQuiz.status,
        createdAt: createdQuiz.createdAt,
        updatedAt: createdQuiz.updatedAt,
        questions: createdQuestions,
        stats: {
          totalQuestions: createdQuestions.length,
          activeQuestions: createdQuestions.filter((q: any) => q.status === 'active').length,
          questionsWithAnswers: createdQuestions.filter((q: any) => q.hasCorrectAnswer).length,
          totalAttempts: 0,
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