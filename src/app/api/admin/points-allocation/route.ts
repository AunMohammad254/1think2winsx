import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import prisma from '@/lib/prisma';
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
      completedAt: Date;
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
const CACHE_DURATION = 3 * 60 * 1000; // 3 minutes cache for admin data

const pointsAllocationSchema = z.object({
  quizId: z.string().min(1, 'Quiz ID is required'),
  pointsPerWinner: z.number().min(1).max(1000).default(10),
  percentageThreshold: z.number().min(0.01).max(100).default(10)
});

// POST /api/admin/points-allocation - Allocate points to top 10% performers
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

    // Check if quiz exists and is evaluated
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        attempts: {
          where: {
            isEvaluated: true
          },
          include: { user: true },
          orderBy: [
            { score: 'desc' },
            { createdAt: 'asc' } // Earlier submissions get priority in case of ties
          ]
        }
      }
    });

    if (!quiz) {
      return NextResponse.json(
        { message: 'Quiz not found' },
        { status: 404 }
      );
    }

    if (quiz.attempts.length === 0) {
      return NextResponse.json(
        { message: 'No evaluated quiz attempts found for this quiz' },
        { status: 400 }
      );
    }

    // Calculate top percentage threshold with minimum 1 user
    const totalAttempts = quiz.attempts.length;
    const topPercentageCount = Math.max(1, Math.ceil(totalAttempts * (percentageThreshold / 100)));

    // Get top performers (those with highest scores)
    const topPerformers = quiz.attempts.slice(0, topPercentageCount);

    // Filter out attempts with score 0 (no correct answers)
    const eligibleWinners = topPerformers.filter(attempt => attempt.score > 0);

    if (eligibleWinners.length === 0) {
      return NextResponse.json(
        { message: 'No eligible winners found (all top performers scored 0)' },
        { status: 400 }
      );
    }

    // Allocate points in a transaction using batch operations
    const allocationResult = await executeCriticalTransaction(async (tx) => {
      // Use batch operations for better performance
      const userIds = eligibleWinners.map(attempt => attempt.userId);
      const attemptIds = eligibleWinners.map(attempt => attempt.id);

      // Batch update user points
      await tx.user.updateMany({
        where: {
          id: { in: userIds }
        },
        data: {
          points: {
            increment: pointsPerWinner
          }
        }
      });

      // Batch update quiz attempts with allocated points
      await tx.quizAttempt.updateMany({
        where: {
          id: { in: attemptIds }
        },
        data: {
          points: pointsPerWinner
        }
      });

      // Get updated user data for response
      const updatedUsers = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, points: true }
      });

      const pointsAllocations = eligibleWinners.map(attempt => {
        const updatedUser = updatedUsers.find(u => u.id === attempt.userId);
        return {
          userId: attempt.userId,
          userEmail: attempt.user.email,
          userName: attempt.user.name,
          score: attempt.score,
          pointsAwarded: pointsPerWinner,
          newTotalPoints: updatedUser?.points || 0
        };
      });

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
    const skip = (page - 1) * limit;

    // Create cache key based on query parameters
    const cacheKey = `points_allocation_${quizId || 'all'}_${page}_${limit}`;

    // Check cache first
    const cached = pointsAllocationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      return NextResponse.json(cached.data);
    }

    // Build where clause
    const where: {
      type: string;
      quizId?: string;
    } = {
      type: 'EARNED'
    };

    if (quizId) {
      where.quizId = quizId;
    }

    // Get quiz attempts with points awarded instead of pointsTransaction
    const [attempts, totalCount] = await Promise.all([
      prisma.quizAttempt.findMany({
        where: {
          ...where,
          points: { gt: 0 } // Only attempts that have been awarded points
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          quiz: {
            select: {
              id: true,
              title: true
            }
          }
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.quizAttempt.count({
        where: {
          ...where,
          points: { gt: 0 }
        }
      })
    ]);

    const responseData = {
      attempts: attempts.map(attempt => ({
        id: attempt.id,
        userId: attempt.userId,
        quizId: attempt.quizId,
        score: attempt.score,
        pointsAwarded: attempt.points,
        completedAt: attempt.updatedAt,
        user: {
          id: attempt.user.id,
          username: attempt.user.name || '',
          email: attempt.user.email
        },
        quiz: {
          id: attempt.quiz.id,
          title: attempt.quiz.title
        }
      })),
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNext: skip + limit < totalCount,
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
