import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6).optional(),
});

// GET /api/profile - Get user profile
export async function GET() {
  try {
    const session = await auth();

    if (!session || !session.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Get user profile with statistics
    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        profilePicture: true,
        points: true,
        createdAt: true,
        _count: {
          select: {
            quizAttempts: true,
            winnings: true,
          },
        },
      },
    });

    // If user doesn't exist in Prisma, create them
    if (!user) {
      try {
        const newUser = await prisma.user.create({
          data: {
            id: userId,
            email: session.user.email || `user_${userId}@placeholder.local`,
            name: session.user.name || null,
          },
        });

        user = {
          ...newUser,
          _count: {
            quizAttempts: 0,
            winnings: 0,
          },
        };
      } catch (createError) {
        // User might have been created by another request, try to fetch again
        console.error('Error creating user in profile:', createError);
        user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            name: true,
            email: true,
            profilePicture: true,
            points: true,
            createdAt: true,
            _count: {
              select: {
                quizAttempts: true,
                winnings: true,
              },
            },
          },
        });

        if (!user) {
          return NextResponse.json(
            { message: 'User not found and could not be created' },
            { status: 404 }
          );
        }
      }
    }

    // Get user's quiz history with detailed information
    // Filter out attempts where the quiz has been deleted
    const rawQuizHistory = await prisma.quizAttempt.findMany({
      where: { userId },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            description: true,
            questions: {
              select: {
                id: true,
              },
            },
          },
        },
        answers: {
          select: {
            id: true,
            isCorrect: true,
            question: {
              select: {
                id: true,
                text: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter out attempts where quiz is null (deleted quizzes) and add question count
    const quizHistory = rawQuizHistory
      .filter(attempt => attempt.quiz !== null)
      .map(attempt => ({
        ...attempt,
        quiz: {
          ...attempt.quiz,
          _count: {
            questions: attempt.quiz?.questions?.length || 0,
          },
        },
      }));

    // Get user's best scores (top 5)
    const rawBestScores = await prisma.quizAttempt.findMany({
      where: { userId },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: { score: 'desc' },
      take: 10, // Get more initially to account for null quizzes
    });

    // Filter out attempts where quiz is null and take top 5
    const bestScores = rawBestScores.filter(attempt => attempt.quiz !== null).slice(0, 5);

    // Get user's recent winnings from quizzes
    const rawRecentWinnings = await prisma.winning.findMany({
      where: { userId },
      include: {
        prize: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        quiz: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10, // Get more initially to account for null quizzes
    });

    // Filter out winnings where quiz or prize is null
    const recentWinnings = rawRecentWinnings.filter(winning => winning.quiz !== null && winning.prize !== null).slice(0, 5);

    // Get user's prize redemptions (prizes bought with points)
    const prizeRedemptions = await prisma.prizeRedemption.findMany({
      where: {
        userId,
        status: { in: ['pending', 'approved', 'fulfilled'] } // Include all successful redemptions
      },
      include: {
        prize: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: 5,
    });

    // Combine winnings and redemptions into a unified format
    const allPrizes = [
      ...recentWinnings.map(winning => ({
        id: winning.id,
        type: 'quiz_win',
        prize: winning.prize,
        quiz: winning.quiz,
        dateWon: winning.createdAt,
        status: winning.claimed ? 'claimed' : 'unclaimed'
      })),
      ...prizeRedemptions.map(redemption => ({
        id: redemption.id,
        type: 'redemption',
        prize: redemption.prize,
        quiz: null,
        dateWon: redemption.requestedAt,
        status: redemption.status,
        pointsUsed: redemption.pointsUsed
      }))
    ].sort((a, b) => new Date(b.dateWon).getTime() - new Date(a.dateWon).getTime()).slice(0, 10);

    // Get direct count of quiz attempts to fix the _count issue
    const totalQuizAttempts = await prisma.quizAttempt.count({
      where: { userId },
    });

    // Get direct count of winnings to fix the _count issue
    const totalWinnings = await prisma.winning.count({
      where: { userId },
    });

    // Get count of successful prize redemptions
    const totalRedemptions = await prisma.prizeRedemption.count({
      where: {
        userId,
        status: { in: ['pending', 'approved', 'fulfilled'] }
      },
    });

    return createSecureJsonResponse({
      user: {
        id: user.id,
        name: user.name,
        email: user.email, // Only expose to the user themselves
        profilePicture: user.profilePicture,
        points: user.points, // Include user points in response
        createdAt: user.createdAt,
        totalQuizAttempts: totalQuizAttempts,
        totalWinnings: totalWinnings + totalRedemptions, // Include both quiz wins and redemptions
      },
      quizHistory,
      bestScores,
      recentWinnings: allPrizes, // Return combined prizes instead of just quiz winnings
    }, { status: 200 });
  } catch (error) {
    console.error('Error fetching profile:', error);

    if (error instanceof Prisma.PrismaClientInitializationError) {
      return NextResponse.json(
        { message: 'Database connection error' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/profile - Update user profile
export async function PUT(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const session = await auth();

    if (!session || !session.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Apply rate limiting
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.profile,
      request,
      userId,
      '/api/profile'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const body = await request.json();

    // Validate request body
    const validationResult = updateProfileSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { message: 'Invalid input', errors: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { name, email, currentPassword, newPassword } = validationResult.data;

    // Get current user data
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      );
    }

    // Prepare update data
    const updateData: Prisma.UserUpdateInput = {};

    if (name) {
      updateData.name = name;
    }

    if (email) {
      // Check if email is already taken by another user
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          NOT: { id: userId },
        },
      });

      if (existingUser) {
        return NextResponse.json(
          { message: 'Email already in use' },
          { status: 400 }
        );
      }

      updateData.email = email;
    }

    // Handle password change
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { message: 'Current password is required to change password' },
          { status: 400 }
        );
      }

      // Check if user has a password (OAuth users may not have one)
      if (!currentUser.password) {
        return NextResponse.json(
          { message: 'Cannot change password for OAuth accounts' },
          { status: 400 }
        );
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, currentUser.password);
      if (!isCurrentPasswordValid) {
        return NextResponse.json(
          { message: 'Current password is incorrect' },
          { status: 400 }
        );
      }

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 12);
      updateData.password = hashedNewPassword;
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    return createSecureJsonResponse({
      message: 'Profile updated successfully',
      user: updatedUser,
    }, { status: 200 });
  } catch (error) {
    console.error('Error updating profile:', error);

    // Handle specific Prisma errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return NextResponse.json(
          { message: 'Email already in use' },
          { status: 409 }
        );
      }
      if (error.code === 'P2025') {
        return NextResponse.json(
          { message: 'User not found' },
          { status: 404 }
        );
      }
    }

    if (error instanceof Prisma.PrismaClientInitializationError) {
      return NextResponse.json(
        { message: 'Database connection error' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
