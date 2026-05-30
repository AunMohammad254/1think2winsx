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

    // Call high-performance server-side aggregation RPC
    const { data: rankedData, error: rpcError } = await supabase.rpc('get_leaderboard', {
      p_timeframe: timeframe,
      p_limit: limit,
      p_quiz_id: quizId || null
    });

    if (rpcError) {
      console.error('Leaderboard RPC error:', rpcError);
      return NextResponse.json(
        { message: 'Error fetching leaderboard' },
        { status: 500 }
      );
    }

    const responseData = {
      users: (rankedData || []).map((user: any) => ({
        id: user.id,
        username: user.userName || '',
        profilePicture: user.profilePicture,
        totalScore: user.totalScore,
        quizCount: user.quizzesTaken,
        averageScore: user.averageScore,
        lastQuizDate: new Date()
      })),
      leaderboard: rankedData || [],
      total: (rankedData || []).length,
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
