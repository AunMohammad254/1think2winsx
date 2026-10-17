import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { securityLogger } from '@/lib/security-logger';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { sendPasswordSetupEmail } from '@/lib/password-setup';
import { detectForUser } from '@/lib/auth-detection-server';
import { CAPTCHA_FAILED_MESSAGE, CAPTCHA_REQUIRED_MESSAGE, isCaptchaError } from '@/lib/captcha';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
});

// PUT /api/profile/change-password - Change user password
// Uses Supabase Auth for password verification and update
export async function PUT(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    const supabase = await createClient();

    // Get current user from Supabase Auth
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      securityLogger.logUnauthorizedAccess(undefined, '/api/profile/change-password', request);
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = user.id;

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

    // Both branches below make one Supabase call that needs a Turnstile token (a reset email, or
    // signing in with the current password), so the token is required before either
    const body = await request.json().catch(() => ({}));
    const captchaToken: unknown = body?.captchaToken;
    if (typeof captchaToken !== 'string' || !captchaToken) {
      return NextResponse.json({ message: CAPTCHA_REQUIRED_MESSAGE }, { status: 400 });
    }

    // Accounts created with Google have no password to "change". Instead of refusing, email them a
    // link to set one (checked before validating the body so a missing current password isn't a dead end).
    if (!(await detectForUser(supabase, user)).hasPassword) {
      const sent = user.email
        ? await sendPasswordSetupEmail(supabase, user.email, captchaToken)
        : { ok: false, captchaFailed: false };
      if (!sent.ok) {
        return sent.captchaFailed
          ? NextResponse.json({ message: CAPTCHA_FAILED_MESSAGE }, { status: 400 })
          : NextResponse.json(
            { message: "We couldn't send the email right now. Please try again in a minute." },
            { status: 502 }
          );
      }
      return NextResponse.json({
        resetEmailSent: true,
        message: 'Your account uses Google sign-in, so we emailed you a link to set a password.',
      });
    }

    // Validate request body
    const validationResult = changePasswordSchema.safeParse(body);
    if (!validationResult.success) {
      securityLogger.logInvalidInput(userId, '/api/profile/change-password', validationResult.error.issues, request);
      return NextResponse.json(
        { message: 'Invalid input', errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = validationResult.data;

    // Verify current password by attempting to sign in with it
    // This is the secure way to verify the password without storing it in public.User
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
      options: { captchaToken },
    });

    // A failed check is not a wrong password, so it is not recorded as one
    if (isCaptchaError(signInError)) {
      return NextResponse.json({ message: CAPTCHA_FAILED_MESSAGE }, { status: 400 });
    }

    if (signInError) {
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

    // currentPassword was just verified, so the new one matches the real password exactly when it
    // matches this string (a second sign-in to check would need a second Turnstile token)
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { message: 'New password must be different from current password' },
        { status: 400 }
      );
    }

    // Update password using Supabase Auth
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (updateError) {
      console.error('[change-password] Error updating password:', updateError);
      return NextResponse.json(
        { message: updateError.message || 'Failed to update password' },
        { status: 400 }
      );
    }

    // Log successful password change
    securityLogger.logSecurityEvent({
      type: 'PASSWORD_CHANGE',
      userId: userId,
      endpoint: '/api/profile/change-password',
      details: {
        action: 'User successfully changed password via Supabase Auth',
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
