import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { z } from 'zod';

// Simple in-memory cache for leaderboard data
const leaderboardCache = new Map<string, { data: { users: Array<{ id: string; username: string; totalScore: number; quizCount: number; averageScore: number; lastQuizDate: Date }> }; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

// Input validation schema
const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  timeframe: z.enum(['weekly', 'monthly', 'allTime']).default('allTime'),
  quizId: z.string().regex(/^[0-9a-fA-F]{24}$/).nullable().optional(),
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

    // Calculate date filter based on timeframe
    let dateFilter = {};
    const now = new Date();
    
    if (timeframe === 'weekly') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      dateFilter = { createdAt: { gte: weekAgo } };
    } else if (timeframe === 'monthly') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      dateFilter = { createdAt: { gte: monthAgo } };
    }

    // Base query for leaderboard
    let whereClause = { ...dateFilter };
    
    // If quizId is provided, filter by specific quiz
    if (quizId) {
      whereClause = { ...whereClause, quizId };
    }

    // Get aggregated user statistics with optimized query
    const userStats = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        points: true, // Include points for faster sorting
        quizAttempts: {
          where: whereClause,
          select: {
            id: true,
            score: true,
            createdAt: true,
            answers: {
              where: { isCorrect: true },
              select: { id: true }
            }
          },
        },
        _count: {
          select: {
            winnings: {
              where: dateFilter
            },
            prizeRedemptions: true
          }
        },
        prizeRedemptions: {
          where: {
            status: { in: ['pending', 'approved', 'fulfilled'] }
          },
          select: { id: true }
        }
      }
    });

    // Calculate aggregated statistics for each user with optimized processing
    const leaderboardData = userStats
      .filter(user => user.quizAttempts.length > 0) // Only include users with quiz attempts in the timeframe
      .map(user => {
        const attempts = user.quizAttempts;
        const totalScore = attempts.reduce((sum, attempt) => sum + attempt.score, 0);
        const correctAnswers = attempts.reduce((sum, attempt) => 
          sum + (attempt.answers?.length || 0), 0
        );
        
        return {
          id: user.id,
          userName: user.name,
          quizzesTaken: attempts.length,
          correctAnswers,
          totalScore,
          winCount: user._count.winnings + user.prizeRedemptions.length,
          averageScore: attempts.length > 0 ? Math.round(totalScore / attempts.length) : 0,
        };
      })
      .sort((a, b) => {
        // Optimized sorting: total score first, then average score, then quiz count
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
      users: leaderboardData.map(user => ({
        id: user.id,
        username: user.userName || '',
        totalScore: user.totalScore,
        quizCount: user.quizzesTaken,
        averageScore: user.averageScore,
        lastQuizDate: new Date() // Using current date as placeholder
      })),
      leaderboard: leaderboardData,
      total: leaderboardData.length,
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
