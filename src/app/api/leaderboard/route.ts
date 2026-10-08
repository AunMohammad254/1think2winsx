import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/supabase/db';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { z } from 'zod';

// In-process cache + single-flight: concurrent cache misses share ONE database call.
const leaderboardCache = new Map<string, { data: any; timestamp: number }>();
const inflight = new Map<string, Promise<any>>();
const CACHE_DURATION = 60 * 1000; // 1 minute (the DB side is refreshed every 5 minutes)
// Hard ceiling on cached keys. The cleanup below only evicts EXPIRED entries, so a burst of
// unique query strings (each a new key) could otherwise grow memory for a full minute.
const MAX_CACHE_ENTRIES = 200;
// Quiz-scoped boards bypass the database-side cache and are computed live (~1.3 s at 50k
// users), so only a few distinct ones may be computed at the same moment.
const MAX_CONCURRENT_QUIZ_SCOPED = 6;
// Public, identical for every visitor -> let the CDN / reverse proxy / browser cache it.
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' };

// Input validation schema
const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  timeframe: z.enum(['weekly', 'monthly', 'allTime']).default('allTime'),
  // Ids are cuid/uuid-like: reject anything else instead of turning arbitrary strings into
  // cache keys and live database scans.
  quizId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable().optional(),
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
    // Scoped keys carry a "q:" marker so they can be told apart from the global board
    const cacheKey = `leaderboard_${limit}_${timeframe}_${quizId ? `q:${quizId}` : 'all'}`;

    // Check cache first
    const cached = leaderboardCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      return createSecureJsonResponse(cached.data, { status: 200, headers: CACHE_HEADERS });
    }

    let pending = inflight.get(cacheKey);
    if (!pending) {
      if (quizId) {
        // Quiz-scoped boards are the expensive, unauthenticated path: limit per IP, and cap how
        // many distinct ones may be computed at once (shed with a short Retry-After).
        const limited = await applyRateLimit(rateLimiters.general, request, undefined, '/api/leaderboard');
        if (limited) return limited;
        const scopedInflight = [...inflight.keys()].filter((k) => k.includes('_q:')).length;
        if (scopedInflight >= MAX_CONCURRENT_QUIZ_SCOPED) {
          return NextResponse.json(
            { message: 'Leaderboard is busy, please retry shortly' },
            { status: 503, headers: { 'Retry-After': '3' } }
          );
        }
      }
      pending = loadLeaderboard(cacheKey, limit, timeframe, quizId || null).finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, pending);
    }
    const responseData = await pending;
    if (!responseData) {
      return NextResponse.json({ message: 'Error fetching leaderboard' }, { status: 500 });
    }
    return createSecureJsonResponse(responseData, { status: 200, headers: CACHE_HEADERS });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function loadLeaderboard(cacheKey: string, limit: number, timeframe: string, quizId: string | null) {
    // get_leaderboard is SECURITY DEFINER and now only executable by the service role.
    const supabase = getAdminDb();

    // Call high-performance server-side aggregation RPC
    const { data: rankedData, error: rpcError } = await supabase.rpc('get_leaderboard', {
      p_timeframe: timeframe,
      p_limit: limit,
      p_quiz_id: quizId || null
    });

    if (rpcError) {
      console.error('Leaderboard RPC error:', rpcError);
      return null;
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
    // Hard cap: a Map iterates in insertion order, so this drops the oldest entries first
    while (leaderboardCache.size > MAX_CACHE_ENTRIES) {
      const oldest = leaderboardCache.keys().next().value;
      if (oldest === undefined) break;
      leaderboardCache.delete(oldest);
    }

    return responseData;
}
