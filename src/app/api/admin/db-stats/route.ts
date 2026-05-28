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

    // Top performing quizzes — batch count via SQL RPC (replaces per-quiz N+1 loop)
    const { data: quizzes } = await supabase
      .from('Quiz')
      .select('id, title')
      .limit(20);

    const quizIds = (quizzes || []).map((q: any) => q.id);
    const { data: attemptCountRows } = quizIds.length > 0
      ? await supabase.rpc('get_quiz_attempt_counts_by_quiz', { quiz_ids: quizIds })
      : { data: [] };

    const attemptCountByQuiz = new Map<string, number>();
    for (const row of (attemptCountRows || [])) {
      attemptCountByQuiz.set(row.quiz_id, Number(row.attempt_count));
    }

    const topQuizzes = (quizzes || [])
      .map((quiz: any) => ({ ...quiz, attemptCount: attemptCountByQuiz.get(quiz.id) || 0 }))
      .sort((a: any, b: any) => b.attemptCount - a.attemptCount)
      .slice(0, 5);

    // Get average scores via SQL aggregate (avoids full table scan)
    const { data: avgScoreData } = await supabase.rpc('get_quiz_attempt_avg_score');
    const avgScore = Number(avgScoreData) || 0;

    // Get completion rate
    const { count: completedAttempts } = await supabase
      .from('QuizAttempt')
      .select('*', { count: 'exact', head: true })
      .eq('isCompleted', true);

    const completionRate = attemptCount && attemptCount > 0
      ? ((completedAttempts || 0) / attemptCount) * 100
      : 0;

    // Get prize distribution via SQL GROUP BY RPC (replaces full Winning table load)
    const { data: prizeDistributionRows } = await supabase.rpc('get_prize_distribution');
    const prizeDistributionWithDetails = (prizeDistributionRows || []).map((row: any) => ({
      prizeId: row.prize_id,
      prizeName: row.prize_name || 'Unknown',
      prizeType: row.prize_type || 'Unknown',
      count: Number(row.win_count),
    }));

    const response = createSecureJsonResponse({
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
      topQuizzes: topQuizzes.map((quiz: any) => ({
        id: quiz.id,
        title: quiz.title,
        attemptCount: quiz.attemptCount,
      })),
      prizeDistribution: prizeDistributionWithDetails,
    }, { status: 200 });

    // Cache admin stats for 60s — data doesn't need to be real-time
    response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=30');
    return response;
  } catch (error) {
    console.error('Error fetching database statistics:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
