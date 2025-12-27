import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/supabase/db';
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

    const supabase = await getDb();

    // Get database statistics
    const [
      { count: userCount },
      { count: quizCount },
      { count: questionCount },
      { count: attemptCount },
      { count: paymentCount },
      { count: winningCount }
    ] = await Promise.all([
      supabase.from('User').select('*', { count: 'exact', head: true }),
      supabase.from('Quiz').select('*', { count: 'exact', head: true }),
      supabase.from('Question').select('*', { count: 'exact', head: true }),
      supabase.from('QuizAttempt').select('*', { count: 'exact', head: true }),
      supabase.from('DailyPayment').select('*', { count: 'exact', head: true }),
      supabase.from('Winning').select('*', { count: 'exact', head: true }),
    ]);

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString();

    const [
      { count: recentUsers },
      { count: recentAttempts },
      { count: recentPayments },
      { count: recentWinnings }
    ] = await Promise.all([
      supabase.from('User').select('*', { count: 'exact', head: true }).gte('createdAt', sevenDaysAgoStr),
      supabase.from('QuizAttempt').select('*', { count: 'exact', head: true }).gte('createdAt', sevenDaysAgoStr),
      supabase.from('DailyPayment').select('*', { count: 'exact', head: true }).gte('createdAt', sevenDaysAgoStr),
      supabase.from('Winning').select('*', { count: 'exact', head: true }).gte('createdAt', sevenDaysAgoStr),
    ]);

    // Top performing quizzes
    const { data: quizzes } = await supabase
      .from('Quiz')
      .select('id, title');

    const topQuizzesData = await Promise.all(
      (quizzes || []).slice(0, 10).map(async (quiz: any) => {
        const { count } = await supabase
          .from('QuizAttempt')
          .select('*', { count: 'exact', head: true })
          .eq('quizId', quiz.id);
        return { ...quiz, attemptCount: count || 0 };
      })
    );

    const topQuizzes = topQuizzesData
      .sort((a, b) => b.attemptCount - a.attemptCount)
      .slice(0, 5);

    // Get average scores
    const { data: attemptScores } = await supabase
      .from('QuizAttempt')
      .select('score');

    const avgScore = attemptScores && attemptScores.length > 0
      ? attemptScores.reduce((sum, a) => sum + a.score, 0) / attemptScores.length
      : 0;

    // Get completion rate
    const { count: completedAttempts } = await supabase
      .from('QuizAttempt')
      .select('*', { count: 'exact', head: true })
      .eq('isCompleted', true);

    const completionRate = attemptCount && attemptCount > 0
      ? ((completedAttempts || 0) / attemptCount) * 100
      : 0;

    // Get prize distribution
    const { data: winnings } = await supabase
      .from('Winning')
      .select('prizeId');

    const prizeDistribution: Record<string, number> = {};
    (winnings || []).forEach((w: any) => {
      prizeDistribution[w.prizeId] = (prizeDistribution[w.prizeId] || 0) + 1;
    });

    const { data: prizes } = await supabase
      .from('Prize')
      .select('id, name, type');

    const prizeDistributionWithDetails = Object.entries(prizeDistribution).map(([prizeId, count]) => {
      const prize = (prizes || []).find((p: any) => p.id === prizeId);
      return {
        prizeId,
        prizeName: prize?.name || 'Unknown',
        prizeType: prize?.type || 'Unknown',
        count,
      };
    }).sort((a, b) => b.count - a.count);

    return createSecureJsonResponse({
      overview: {
        totalUsers: userCount || 0,
        totalQuizzes: quizCount || 0,
        totalQuestions: questionCount || 0,
        totalAttempts: attemptCount || 0,
        totalPayments: paymentCount || 0,
        totalWinnings: winningCount || 0,
        averageScore: Math.round(avgScore * 100) / 100,
        completionRate: Math.round(completionRate * 100) / 100,
      },
      recentActivity: {
        newUsers: recentUsers || 0,
        newAttempts: recentAttempts || 0,
        newPayments: recentPayments || 0,
        newWinnings: recentWinnings || 0,
      },
      topQuizzes: topQuizzes.map(quiz => ({
        id: quiz.id,
        title: quiz.title,
        attemptCount: quiz.attemptCount,
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
