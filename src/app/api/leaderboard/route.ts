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
        { message: 'Invalid query parameters', errors: validationResult.error.issues },
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
    let dateFilter: string | null = null;
    const now = new Date();

    if (timeframe === 'weekly') {
      dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (timeframe === 'monthly') {
      dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    // Fetch all required data in batch
    let attemptsQuery = supabase.from('QuizAttempt').select('userId, score, createdAt');
    let correctAnswersQuery = supabase.from('Answer').select('userId').eq('isCorrect', true);
    let winningsQuery = supabase.from('Winning').select('userId');
    let usersQuery = supabase.from('User').select('id, name, profilePicture');

    if (dateFilter) {
      attemptsQuery = attemptsQuery.gte('createdAt', dateFilter);
      correctAnswersQuery = correctAnswersQuery.gte('createdAt', dateFilter);
      winningsQuery = winningsQuery.gte('createdAt', dateFilter);
    }
    if (quizId) {
      attemptsQuery = attemptsQuery.eq('quizId', quizId);
    }

    const [
      { data: attempts },
      { data: correctAnswers },
      { data: winnings },
      { data: users },
      { data: redemptions }
    ] = await Promise.all([
      attemptsQuery,
      correctAnswersQuery,
      winningsQuery,
      usersQuery,
      supabase.from('PrizeRedemption').select('userId').in('status', ['pending', 'approved', 'fulfilled'])
    ]);

    // Build O(1)-lookup Maps for all aggregates
    const userStats       = new Map<string, { score: number; count: number }>();
    const correctByUser   = new Map<string, number>();
    const winsByUser      = new Map<string, number>();
    const redemptionsByUser = new Map<string, number>();

    for (const a of (attempts || [])) {
      const prev = userStats.get(a.userId) || { score: 0, count: 0 };
      userStats.set(a.userId, { score: prev.score + a.score, count: prev.count + 1 });
    }
    for (const c of (correctAnswers || [])) {
      correctByUser.set(c.userId, (correctByUser.get(c.userId) || 0) + 1);
    }
    for (const w of (winnings || [])) {
      winsByUser.set(w.userId, (winsByUser.get(w.userId) || 0) + 1);
    }
    for (const r of (redemptions || [])) {
      redemptionsByUser.set(r.userId, (redemptionsByUser.get(r.userId) || 0) + 1);
    }

    const leaderboardData = (users || []).map((user: any) => {
      const stats    = userStats.get(user.id) || { score: 0, count: 0 };
      const correct  = correctByUser.get(user.id) || 0;
      const winCount = (winsByUser.get(user.id) || 0) + (redemptionsByUser.get(user.id) || 0);

      return {
        id: user.id,
        userName: user.name,
        profilePicture: user.profilePicture,
        quizzesTaken: stats.count,
        correctAnswers: correct,
        totalScore: stats.score,
        winCount,
        averageScore: stats.count > 0 ? Math.round(stats.score / stats.count) : 0,
      };
    }).filter(u => u.quizzesTaken > 0);

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
        profilePicture: user.profilePicture,
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
