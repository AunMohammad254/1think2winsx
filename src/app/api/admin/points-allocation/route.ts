import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { quizDb, userDb, quizAttemptDb, getDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { executeCriticalTransaction } from '@/lib/transaction-manager';

// Simple in-memory cache for points allocation data
const pointsAllocationCache = new Map<string, {
  data: {
    attempts: Array<{
      id: string;
      userId: string;
      quizId: string;
      score: number;
      pointsAwarded: number;
      completedAt: string;
      user: {
        id: string;
        username: string;
        email: string;
      };
      quiz: {
        id: string;
        title: string;
      };
    }>;
    totalCount: number;
    totalPages: number;
    currentPage: number;
  };
  timestamp: number;
}>();
const CACHE_DURATION = 3 * 60 * 1000;

const pointsAllocationSchema = z.object({
  quizId: z.string().min(1, 'Quiz ID is required'),
  pointsPerWinner: z.number().min(1).max(1000).default(10),
  percentageThreshold: z.number().min(0.01).max(100).default(10)
});

// POST /api/admin/points-allocation - Allocate points to top performers
export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    // Require admin authentication
    const authResult = await requireAuth({ adminOnly: true });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/points-allocation'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/points-allocation',
        rateLimiter: 'admin'
      });
      return rateLimitResponse;
    }

    const body = await request.json();

    // Validate input
    const validationResult = pointsAllocationSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { message: 'Invalid input data', errors: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { quizId, pointsPerWinner, percentageThreshold } = validationResult.data;

    const supabase = await getDb();

    // Get quiz
    const { data: quiz, error: quizError } = await supabase
      .from('Quiz')
      .select('id, title')
      .eq('id', quizId)
      .single();

    if (quizError || !quiz) {
      return NextResponse.json(
        { message: 'Quiz not found' },
        { status: 404 }
      );
    }

    // Get evaluated attempts with user info, ordered by score
    const { data: attempts } = await supabase
      .from('QuizAttempt')
      .select(`
        id, userId, score, createdAt,
        User:userId (id, email, name)
      `)
      .eq('quizId', quizId)
      .eq('isEvaluated', true)
      .order('score', { ascending: false })
      .order('createdAt', { ascending: true });

    if (!attempts || attempts.length === 0) {
      return NextResponse.json(
        { message: 'No evaluated quiz attempts found for this quiz' },
        { status: 400 }
      );
    }

    // Calculate top percentage threshold with minimum 1 user
    const totalAttempts = attempts.length;
    const topPercentageCount = Math.max(1, Math.ceil(totalAttempts * (percentageThreshold / 100)));

    // Get top performers (those with highest scores)
    const topPerformers = attempts.slice(0, topPercentageCount);

    // Filter out attempts with score 0 (no correct answers)
    const eligibleWinners = topPerformers.filter((attempt: { score: number }) => attempt.score > 0);

    if (eligibleWinners.length === 0) {
      return NextResponse.json(
        { message: 'No eligible winners found (all top performers scored 0)' },
        { status: 400 }
      );
    }

    // Allocate points
    const allocationResult = await executeCriticalTransaction(async () => {
      const pointsAllocations = [];

      for (const attempt of eligibleWinners) {
        // Handle Supabase join - can return array or single object
        const userRaw = attempt.User;
        const user = Array.isArray(userRaw) ? userRaw[0] : userRaw;
        const userId = attempt.userId;

        // Update user points
        const { data: currentUser } = await supabase
          .from('User')
          .select('points')
          .eq('id', userId)
          .single();

        const newPoints = (currentUser?.points || 0) + pointsPerWinner;

        await supabase
          .from('User')
          .update({ points: newPoints, updatedAt: new Date().toISOString() })
          .eq('id', userId);

        // Update quiz attempt with allocated points
        await supabase
          .from('QuizAttempt')
          .update({ points: pointsPerWinner, updatedAt: new Date().toISOString() })
          .eq('id', attempt.id);

        pointsAllocations.push({
          userId: userId,
          userEmail: user?.email || '',
          userName: user?.name || null,
          score: attempt.score,
          pointsAwarded: pointsPerWinner,
          newTotalPoints: newPoints
        });
      }

      return pointsAllocations;
    }, {
      context: 'points_allocation',
      userId: session.user.id,
      description: `Points allocation for quiz ${quizId}`
    });

    return NextResponse.json({
      success: true,
      message: 'Points allocated successfully',
      quiz: {
        id: quiz.id,
        title: quiz.title
      },
      allocation: {
        totalAttempts,
        topPercentageCount,
        eligibleWinners: eligibleWinners.length,
        pointsPerWinner,
        totalPointsDistributed: eligibleWinners.length * pointsPerWinner,
        percentageThreshold
      },
      winners: allocationResult
    }, { status: 200 });

  } catch (error) {
    console.error('Error allocating points:', error);

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/admin/points-allocation - Get points allocation history
export async function GET(request: NextRequest) {
  try {
    // Require admin authentication
    const authResult = await requireAuth({ adminOnly: true });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { session } = authResult;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/points-allocation'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/points-allocation',
        rateLimiter: 'admin',
        method: 'GET'
      });
      return rateLimitResponse;
    }

    const url = new URL(request.url);
    const quizId = url.searchParams.get('quizId');
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;

    // Create cache key based on query parameters
    const cacheKey = `points_allocation_${quizId || 'all'}_${page}_${limit}`;

    // Check cache first
    const cached = pointsAllocationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      return NextResponse.json(cached.data);
    }

    const supabase = await getDb();

    // Build query
    let query = supabase
      .from('QuizAttempt')
      .select(`
        id, userId, quizId, score, points, updatedAt,
        User:userId (id, email, name),
        Quiz:quizId (id, title)
      `, { count: 'exact' })
      .gt('points', 0)
      .order('updatedAt', { ascending: false })
      .range(offset, offset + limit - 1);

    if (quizId) {
      query = query.eq('quizId', quizId);
    }

    const { data: attempts, count, error } = await query;

    if (error) throw error;

    const totalCount = count || 0;

    const responseData = {
      attempts: (attempts || []).map((attempt: any) => {
        // Handle Supabase join - can return array or single object
        const userRaw = attempt.User;
        const user = Array.isArray(userRaw) ? userRaw[0] : userRaw;
        const quizRaw = attempt.Quiz;
        const quiz = Array.isArray(quizRaw) ? quizRaw[0] : quizRaw;

        return {
          id: attempt.id,
          userId: attempt.userId,
          quizId: attempt.quizId,
          score: attempt.score,
          pointsAwarded: attempt.points,
          completedAt: attempt.updatedAt,
          user: {
            id: user?.id || '',
            username: user?.name || '',
            email: user?.email || ''
          },
          quiz: {
            id: quiz?.id || '',
            title: quiz?.title || ''
          }
        };
      }),
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNext: offset + limit < totalCount,
        hasPrev: page > 1
      }
    };

    // Store in cache for future requests
    pointsAllocationCache.set(cacheKey, {
      data: responseData,
      timestamp: Date.now()
    });

    // Clean up old cache entries periodically
    if (pointsAllocationCache.size > 50) {
      const now = Date.now();
      for (const [key, value] of pointsAllocationCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
          pointsAllocationCache.delete(key);
        }
      }
    }

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Error getting points allocation history:', error);

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
