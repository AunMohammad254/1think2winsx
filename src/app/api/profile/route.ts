import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { userDb, quizAttemptDb, prizeRedemptionDb, getDb, generateId } from '@/lib/supabase/db';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
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
    const supabase = await getDb();

    // Get user profile
    let { data: user, error } = await supabase
      .from('User')
      .select('id, name, email, profilePicture, points, walletBalance, createdAt')
      .eq('id', userId)
      .single();

    // If user doesn't exist, try to find by email or create
    if (error && error.code === 'PGRST116') {
      // Try find by email
      if (session.user.email) {
        const { data: userByEmail } = await supabase
          .from('User')
          .select('id, name, email, profilePicture, points, walletBalance, createdAt')
          .eq('email', session.user.email)
          .single();

        if (userByEmail) {
          user = userByEmail;
        }
      }

      // Create new user if not found
      if (!user) {
        try {
          const newUser = await userDb.create({
            id: userId,
            email: session.user.email || `user_${userId}@placeholder.local`,
            name: session.user.name || null,
            password: null,
            authProvider: 'google', // Mark as OAuth signup (Google is the primary provider)
          });
          user = newUser;
        } catch (createError) {
          console.error('Error creating user in profile:', createError);
          return NextResponse.json(
            { message: 'User not found and could not be created' },
            { status: 404 }
          );
        }
      }
    } else if (error) {
      throw error;
    }

    if (!user) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      );
    }

    // Get quiz attempts count
    const { count: totalQuizAttempts } = await supabase
      .from('QuizAttempt')
      .select('*', { count: 'exact', head: true })
      .eq('userId', userId);

    // Get quiz history with quiz info
    const { data: rawQuizHistory } = await supabase
      .from('QuizAttempt')
      .select(`
        id, score, points, isCompleted, isEvaluated, completedAt, createdAt,
        Quiz:quizId (id, title, description)
      `)
      .eq('userId', userId)
      .order('createdAt', { ascending: false })
      .limit(20);

    // Get answers for each attempt
    const quizHistory = [];
    for (const attempt of rawQuizHistory || []) {
      if (!attempt.Quiz) continue;

      const { data: answers } = await supabase
        .from('Answer')
        .select('id, isCorrect, questionId')
        .eq('quizAttemptId', attempt.id);

      // Get question count for quiz
      const quizRaw = attempt.Quiz;
      const quiz = Array.isArray(quizRaw) ? quizRaw[0] : quizRaw;

      const { count: questionCount } = await supabase
        .from('Question')
        .select('*', { count: 'exact', head: true })
        .eq('quizId', quiz?.id);

      quizHistory.push({
        ...attempt,
        quiz: {
          ...quiz,
          _count: { questions: questionCount || 0 }
        },
        answers: answers || []
      });
    }

    // Get best scores (top 5)
    const { data: rawBestScores } = await supabase
      .from('QuizAttempt')
      .select(`
        id, score, points, createdAt,
        Quiz:quizId (id, title)
      `)
      .eq('userId', userId)
      .order('score', { ascending: false })
      .limit(10);

    const bestScores = (rawBestScores || [])
      .filter((a: any) => a.Quiz)
      .slice(0, 5)
      .map((a: any) => ({
        ...a,
        quiz: Array.isArray(a.Quiz) ? a.Quiz[0] : a.Quiz
      }));

    // Get winnings count
    const { count: totalWinnings } = await supabase
      .from('Winning')
      .select('*', { count: 'exact', head: true })
      .eq('userId', userId);

    // Get recent winnings
    const { data: rawRecentWinnings } = await supabase
      .from('Winning')
      .select(`
        id, claimed, createdAt,
        Prize:prizeId (id, name, type),
        Quiz:quizId (id, title)
      `)
      .eq('userId', userId)
      .order('createdAt', { ascending: false })
      .limit(10);

    const recentWinnings = (rawRecentWinnings || [])
      .filter((w: any) => w.Quiz && w.Prize)
      .slice(0, 5)
      .map((w: any) => ({
        id: w.id,
        type: 'quiz_win',
        prize: Array.isArray(w.Prize) ? w.Prize[0] : w.Prize,
        quiz: Array.isArray(w.Quiz) ? w.Quiz[0] : w.Quiz,
        dateWon: w.createdAt,
        status: w.claimed ? 'claimed' : 'unclaimed'
      }));

    // Get prize redemptions
    const { data: prizeRedemptions } = await supabase
      .from('PrizeRedemption')
      .select(`
        id, pointsUsed, status, requestedAt,
        Prize:prizeId (id, name, type)
      `)
      .eq('userId', userId)
      .in('status', ['pending', 'approved', 'fulfilled'])
      .order('requestedAt', { ascending: false })
      .limit(5);

    const redemptionsList = (prizeRedemptions || []).map((r: any) => ({
      id: r.id,
      type: 'redemption',
      prize: Array.isArray(r.Prize) ? r.Prize[0] : r.Prize,
      quiz: null,
      dateWon: r.requestedAt,
      status: r.status,
      pointsUsed: r.pointsUsed
    }));

    // Combine winnings and redemptions
    const allPrizes = [...recentWinnings, ...redemptionsList]
      .sort((a, b) => new Date(b.dateWon).getTime() - new Date(a.dateWon).getTime())
      .slice(0, 10);

    // Get redemptions count
    const { count: totalRedemptions } = await supabase
      .from('PrizeRedemption')
      .select('*', { count: 'exact', head: true })
      .eq('userId', userId)
      .in('status', ['pending', 'approved', 'fulfilled']);

    return createSecureJsonResponse({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture,
        points: user.points,
        walletBalance: user.walletBalance || 0,
        createdAt: user.createdAt,
        totalQuizAttempts: totalQuizAttempts || 0,
        totalWinnings: (totalWinnings || 0) + (totalRedemptions || 0),
      },
      quizHistory,
      bestScores,
      recentWinnings: allPrizes,
    }, { status: 200 });
  } catch (error) {
    console.error('Error fetching profile:', error);
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
    const currentUser = await userDb.findById(userId);

    if (!currentUser) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      );
    }

    // Prepare update data
    const updateData: Record<string, any> = {};

    if (name) {
      updateData.name = name;
    }

    if (email) {
      // Check if email is already taken by another user
      const supabase = await getDb();
      const { data: existingUser } = await supabase
        .from('User')
        .select('id')
        .eq('email', email)
        .neq('id', userId)
        .single();

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
    const updatedUser = await userDb.update(userId, updateData);

    return createSecureJsonResponse({
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        createdAt: updatedUser.createdAt,
      },
    }, { status: 200 });
  } catch (error) {
    console.error('Error updating profile:', error);

    // Handle Supabase unique constraint violation
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return NextResponse.json(
        { message: 'Email already in use' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
