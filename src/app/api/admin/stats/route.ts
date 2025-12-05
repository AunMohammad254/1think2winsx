import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { securityLogger } from '@/lib/security-logger';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { requireAuth } from '@/lib/auth-middleware';

// GET /api/admin/stats - Get database statistics (admin only)
export async function GET(request: NextRequest) {
  try {
    // Use auth middleware with admin check
    const authResult = await requireAuth({ adminOnly: true });
    
    // If auth failed, return the error response
    if (authResult instanceof NextResponse) {
      securityLogger.logUnauthorizedAccess(
        undefined,
        '/api/admin/stats',
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
      '/api/admin/stats'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Get database statistics
    const [userCount, quizCount, quizAttemptCount, paymentCount, prizeCount] = await Promise.all([
      prisma.user.count(),
      prisma.quiz.count(),
      prisma.quizAttempt.count(),
      prisma.payment.count(),
      prisma.prize.count(),
    ]);

    // Get recent activity
    const recentUsers = await prisma.user.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
    });

    const recentQuizAttempts = await prisma.quizAttempt.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
    });

    // Get payment statistics
    const paymentStats = await prisma.payment.groupBy({
      by: ['status'],
      _count: {
        status: true,
      },
    });

    // Calculate total revenue
    const totalRevenue = await prisma.payment.aggregate({
      where: {
        status: 'completed',
      },
      _sum: {
        amount: true,
      },
    });

    // Calculate average score
    const averageScoreResult = await prisma.quizAttempt.aggregate({
      _avg: {
        score: true,
      },
    });

    const stats = {
      totalUsers: userCount,
      totalQuizzes: quizCount,
      totalQuizAttempts: quizAttemptCount,
      totalPayments: paymentCount,
      totalPrizes: prizeCount,
      recentUsers: recentUsers,
      recentQuizAttempts: recentQuizAttempts,
      totalRevenue: totalRevenue._sum.amount || 0,
      averageScore: averageScoreResult._avg.score || 0,
      paymentsByStatus: paymentStats,
    };

    // Log admin stats access for audit trail
    securityLogger.logSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      details: {
        action: 'ADMIN_STATS_ACCESSED',
        adminUser: {
          id: session.user.id,
          email: session.user.email
        },
        statsRequested: Object.keys(stats)
      }
    }, request);

    return createSecureJsonResponse(stats);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'Failed to retrieve database statistics',
      },
      { status: 500 }
    );
  }
}
