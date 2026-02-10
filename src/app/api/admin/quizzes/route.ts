import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getDb, quizDb, questionDb, generateId } from '@/lib/supabase/db';
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
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search');

    const offset = (page - 1) * limit;
    const supabase = await getDb();

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
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid quiz data', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { title, description, duration, passingScore, isActive, questions } = validationResult.data;
    const supabase = await getDb();

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
        status: isActive ? 'active' : 'paused',
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
        hasCorrectAnswer: true,
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