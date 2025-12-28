import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { userDb } from '@/lib/supabase/db';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { securityLogger } from '@/lib/security-logger';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
});

// PUT /api/profile/change-password - Change user password
export async function PUT(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const session = await auth();

    if (!session || !session.user) {
      securityLogger.logUnauthorizedAccess(undefined, '/api/profile/change-password', request);
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Apply rate limiting (using dedicated password change limiter - 5 attempts per 15 min)
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.passwordChange,
      request,
      userId,
      '/api/profile/change-password'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, userId, {
        endpoint: '/api/profile/change-password',
        rateLimiter: 'passwordChange'
      });
      return rateLimitResponse;
    }

    const body = await request.json();

    // Validate request body
    const validationResult = changePasswordSchema.safeParse(body);
    if (!validationResult.success) {
      securityLogger.logInvalidInput(userId, '/api/profile/change-password', validationResult.error.errors, request);
      return NextResponse.json(
        { message: 'Invalid input', errors: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = validationResult.data;

    // Get current user data
    const currentUser = await userDb.findById(userId);

    if (!currentUser) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      );
    }

    // Check if user has a password (OAuth users may not have one)
    if (!currentUser.password) {
      recordSecurityEvent('INVALID_PASSWORD_ATTEMPT', request, userId, {
        endpoint: '/api/profile/change-password',
        attemptType: 'oauth_user_password_change'
      });
      securityLogger.logAuthFailure(userId, '/api/profile/change-password', 'OAuth user attempting password change');
      return NextResponse.json(
        { message: 'Cannot change password for OAuth accounts' },
        { status: 400 }
      );
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, currentUser.password);
    if (!isCurrentPasswordValid) {
      recordSecurityEvent('INVALID_PASSWORD_ATTEMPT', request, userId, {
        endpoint: '/api/profile/change-password',
        attemptType: 'current_password_verification'
      });
      securityLogger.logAuthFailure(userId, '/api/profile/change-password', 'Invalid current password provided');
      return NextResponse.json(
        { message: 'Current password is incorrect' },
        { status: 400 }
      );
    }

    // Check if new password is different from current
    const isSamePassword = await bcrypt.compare(newPassword, currentUser.password);
    if (isSamePassword) {
      return NextResponse.json(
        { message: 'New password must be different from current password' },
        { status: 400 }
      );
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    // Update user password
    await userDb.update(userId, { password: hashedNewPassword });

    // Log successful password change
    securityLogger.logSecurityEvent({
      type: 'PASSWORD_CHANGE',
      userId: userId,
      endpoint: '/api/profile/change-password',
      details: {
        action: 'User successfully changed password',
        timestamp: new Date().toISOString()
      }
    });

    return NextResponse.json({
      message: 'Password changed successfully',
    }, { status: 200 });

  } catch (error) {
    console.error('Error changing password:', error);

    // Handle connection errors
    if (error instanceof Error && error.message.includes('connection')) {
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
