import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { securityLogger } from '@/lib/security-logger';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { requireAuth } from '@/lib/auth-middleware';

// GET /api/admin/db-stats - Get database statistics (admin only)
export async function GET(request: NextRequest) {
  try {
    // Use auth middleware with admin check
    const authResult = await requireAuth({ adminOnly: true });
    
    // If auth failed, return the error response
    if (authResult instanceof NextResponse) {
      securityLogger.logUnauthorizedAccess(
        undefined,
        '/api/admin/db-stats',
        request
      );
      return authResult;
    }
    
    const { session } = authResult;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/db-stats'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/db-stats',
        rateLimiter: 'admin'
      });
      return rateLimitResponse;
    }

    // Get database statistics
    const [userCount, quizCount, questionCount, attemptCount, paymentCount, winningCount] = await Promise.all([
      prisma.user.count(),
      prisma.quiz.count(),
      prisma.question.count(),
      prisma.quizAttempt.count(),
      prisma.payment.count(),
      prisma.winning.count(),
    ]);

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [recentUsers, recentAttempts, recentPayments, recentWinnings] = await Promise.all([
      prisma.user.count({
        where: {
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
      }),
      prisma.quizAttempt.count({
        where: {
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
      }),
      prisma.payment.count({
        where: {
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
      }),
      prisma.winning.count({
        where: {
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
      }),
    ]);

    // Top performing quizzes - using manual aggregation since _count doesn't work with MongoDB
    const quizzesWithAttempts = await prisma.quiz.findMany({
      include: {
        attempts: {
          select: {
            id: true
          }
        }
      }
    });
    
    const topQuizzes = quizzesWithAttempts
      .map(quiz => ({
        id: quiz.id,
        title: quiz.title,
        _count: {
          attempts: quiz.attempts.length
        }
      }))
      .sort((a, b) => b._count.attempts - a._count.attempts)
      .slice(0, 5);

    // Get average scores
    const averageScoreResult = await prisma.quizAttempt.aggregate({
      _avg: {
        score: true,
      },
    });

    // Get completion rate (completed vs total attempts)
    const completedAttempts = await prisma.quizAttempt.count({
      where: {
        isCompleted: true,
      },
    });

    const completionRate = attemptCount > 0 ? (completedAttempts / attemptCount) * 100 : 0;

    // Get prize distribution
    const prizeDistribution = await prisma.winning.groupBy({
      by: ['prizeId'],
      _count: {
        prizeId: true,
      },
      orderBy: {
        _count: {
          prizeId: 'desc',
        },
      },
    });

    // Get prize details for distribution
    const prizeDetails = await prisma.prize.findMany({
      where: {
        id: {
          in: prizeDistribution.map(p => p.prizeId),
        },
      },
    });

    const prizeDistributionWithDetails = prizeDistribution.map(dist => {
      const prize = prizeDetails.find(p => p.id === dist.prizeId);
      return {
        prizeId: dist.prizeId,
        prizeName: prize?.name || 'Unknown',
        prizeType: prize?.type || 'Unknown',
        count: dist._count.prizeId,
      };
    });

    return createSecureJsonResponse({
      overview: {
        totalUsers: userCount,
        totalQuizzes: quizCount,
        totalQuestions: questionCount,
        totalAttempts: attemptCount,
        totalPayments: paymentCount,
        totalWinnings: winningCount,
        averageScore: averageScoreResult._avg.score || 0,
        completionRate: Math.round(completionRate * 100) / 100,
      },
      recentActivity: {
        newUsers: recentUsers,
        newAttempts: recentAttempts,
        newPayments: recentPayments,
        newWinnings: recentWinnings,
      },
      topQuizzes: topQuizzes.map(quiz => ({
        id: quiz.id,
        title: quiz.title,
        attemptCount: quiz._count.attempts,
      })),
      prizeDistribution: prizeDistributionWithDetails,
    }, { status: 200 });
  } catch (error) {
    console.error('Error fetching database statistics:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
