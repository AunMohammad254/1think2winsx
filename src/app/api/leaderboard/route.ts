import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/supabase/db';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { z } from 'zod';

// Simple in-memory cache for leaderboard data
const leaderboardCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

// Input validation schema
const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  timeframe: z.enum(['weekly', 'monthly', 'allTime']).default('allTime'),
  quizId: z.string().nullable().optional(),
});

// GET /api/leaderboard - Get leaderboard data with aggregated user statistics
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Validate query parameters with proper defaults
    const validationResult = leaderboardQuerySchema.safeParse({
      limit: searchParams.get('limit') || '10',
      timeframe: searchParams.get('timeframe') || 'allTime',
      quizId: searchParams.get('quizId'),
    });

    if (!validationResult.success) {
      return NextResponse.json(
        { message: 'Invalid query parameters', errors: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { limit, timeframe, quizId } = validationResult.data;

    // Create cache key based on query parameters
    const cacheKey = `leaderboard_${limit}_${timeframe}_${quizId || 'all'}`;

    // Check cache first
    const cached = leaderboardCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      return createSecureJsonResponse(cached.data, { status: 200 });
    }

    const supabase = await getDb();

    // Calculate date filter based on timeframe
    let dateFilter: Date | null = null;
    const now = new Date();

    if (timeframe === 'weekly') {
      dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeframe === 'monthly') {
      dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get all users with points
    const { data: users } = await supabase
      .from('User')
      .select('id, name, points')
      .order('points', { ascending: false });

    // Get quiz attempts for each user
    const leaderboardData = [];

    for (const user of (users || []).slice(0, limit * 2)) { // Get extra to filter
      let attemptsQuery = supabase
        .from('QuizAttempt')
        .select('id, score, createdAt')
        .eq('userId', user.id);

      if (dateFilter) {
        attemptsQuery = attemptsQuery.gte('createdAt', dateFilter.toISOString());
      }
      if (quizId) {
        attemptsQuery = attemptsQuery.eq('quizId', quizId);
      }

      const { data: attempts } = await attemptsQuery;

      if (!attempts || attempts.length === 0) continue;

      // Get correct answers count
      let correctAnswersQuery = supabase
        .from('Answer')
        .select('id', { count: 'exact', head: true })
        .eq('userId', user.id)
        .eq('isCorrect', true);

      if (dateFilter) {
        correctAnswersQuery = correctAnswersQuery.gte('createdAt', dateFilter.toISOString());
      }

      const { count: correctAnswers } = await correctAnswersQuery;

      // Get winnings count
      let winningsQuery = supabase
        .from('Winning')
        .select('id', { count: 'exact', head: true })
        .eq('userId', user.id);

      if (dateFilter) {
        winningsQuery = winningsQuery.gte('createdAt', dateFilter.toISOString());
      }

      const { count: winningsCount } = await winningsQuery;

      // Get redemptions count
      const { count: redemptionsCount } = await supabase
        .from('PrizeRedemption')
        .select('id', { count: 'exact', head: true })
        .eq('userId', user.id)
        .in('status', ['pending', 'approved', 'fulfilled']);

      const totalScore = attempts.reduce((sum, a) => sum + a.score, 0);
      const averageScore = attempts.length > 0 ? Math.round(totalScore / attempts.length) : 0;

      leaderboardData.push({
        id: user.id,
        userName: user.name,
        quizzesTaken: attempts.length,
        correctAnswers: correctAnswers || 0,
        totalScore,
        winCount: (winningsCount || 0) + (redemptionsCount || 0),
        averageScore,
      });
    }

    // Sort and rank
    const rankedData = leaderboardData
      .sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
        return b.quizzesTaken - a.quizzesTaken;
      })
      .slice(0, limit)
      .map((user, index) => ({
        ...user,
        rank: index + 1,
      }));

    const responseData = {
      users: rankedData.map(user => ({
        id: user.id,
        username: user.userName || '',
        totalScore: user.totalScore,
        quizCount: user.quizzesTaken,
        averageScore: user.averageScore,
        lastQuizDate: new Date()
      })),
      leaderboard: rankedData,
      total: rankedData.length,
      timeframe,
      lastUpdated: new Date().toISOString(),
    };

    // Store in cache for future requests
    leaderboardCache.set(cacheKey, {
      data: responseData,
      timestamp: Date.now()
    });

    // Clean up old cache entries periodically
    if (leaderboardCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of leaderboardCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
          leaderboardCache.delete(key);
        }
      }
    }

    return createSecureJsonResponse(responseData, { status: 200 });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
