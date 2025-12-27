import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/supabase/db';
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

    const supabase = await getDb();

    // Get database statistics using Supabase
    const [
      { count: userCount },
      { count: quizCount },
      { count: quizAttemptCount },
      { count: paymentCount },
      { count: prizeCount },
    ] = await Promise.all([
      supabase.from('User').select('*', { count: 'exact', head: true }),
      supabase.from('Quiz').select('*', { count: 'exact', head: true }),
      supabase.from('QuizAttempt').select('*', { count: 'exact', head: true }),
      supabase.from('Payment').select('*', { count: 'exact', head: true }),
      supabase.from('Prize').select('*', { count: 'exact', head: true }),
    ]);

    // Get recent activity
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: recentUsers },
      { count: recentQuizAttempts },
    ] = await Promise.all([
      supabase.from('User').select('*', { count: 'exact', head: true }).gte('createdAt', sevenDaysAgo),
      supabase.from('QuizAttempt').select('*', { count: 'exact', head: true }).gte('createdAt', sevenDaysAgo),
    ]);

    // Get payment statistics - use raw query pattern since groupBy isn't available
    const { data: completedPayments } = await supabase
      .from('Payment')
      .select('amount')
      .eq('status', 'completed');

    const totalRevenue = (completedPayments || []).reduce((sum, p) => sum + (p.amount || 0), 0);

    // Get average score
    const { data: quizAttempts } = await supabase
      .from('QuizAttempt')
      .select('score');

    const scores = (quizAttempts || []).map(a => a.score).filter(s => s !== null);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    const stats = {
      totalUsers: userCount || 0,
      totalQuizzes: quizCount || 0,
      totalQuizAttempts: quizAttemptCount || 0,
      totalPayments: paymentCount || 0,
      totalPrizes: prizeCount || 0,
      recentUsers: recentUsers || 0,
      recentQuizAttempts: recentQuizAttempts || 0,
      totalRevenue: totalRevenue,
      averageScore: Math.round(averageScore * 100) / 100,
      paymentsByStatus: [], // Simplified - would need RPC for groupBy
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
