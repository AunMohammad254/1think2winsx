import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { userDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { securityLogger } from '@/lib/security-logger';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { recordSecurityEvent } from '@/lib/security-monitoring';

const registerSchema = z.object({
  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must be less than 50 characters')
    .regex(/^[a-zA-Z\s]+$/, 'Name can only contain letters and spaces')
    .transform(name => name.trim()),
  email: z.string()
    .email('Invalid email address')
    .toLowerCase()
    .max(254, 'Email address too long'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])/, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  phone: z.string()
    .regex(/^(03\d{9}|\+92\d{10})$/, 'Please enter a valid phone number (e.g., 03123456789 or +923123456789)')
    .optional(),
  dateOfBirth: z.string()
    .refine((date) => {
      const birthDate = new Date(date);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      return age >= 13 && age <= 100;
    }, 'You must be between 13 and 100 years old')
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.auth,
      request,
      undefined,
      '/api/register'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, undefined, {
        endpoint: '/api/register',
        rateLimiter: 'auth'
      });
      return rateLimitResponse;
    }

    const body = await request.json();

    // Validate input
    const validationResult = registerSchema.safeParse(body);
    if (!validationResult.success) {
      securityLogger.logInvalidInput(undefined, '/api/register', validationResult.error.errors, request);
      return NextResponse.json(
        { message: 'Invalid input', errors: validationResult.error.errors },
        { status: 400 }
      );
    }

    const validatedData = validationResult.data;
    const { name, email, password, phone, dateOfBirth } = validatedData;

    // Check if user already exists
    const existingUser = await userDb.findByEmail(email);

    if (existingUser) {
      recordSecurityEvent('DUPLICATE_REGISTRATION_ATTEMPT', request, undefined, {
        email: email,
        endpoint: '/api/register'
      });
      return NextResponse.json(
        { message: 'User with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user data object with optional fields
    const userData: {
      name: string;
      email: string;
      password: string;
      phone?: string;
      dateOfBirth?: string;
      authProvider: string;
    } = {
      name,
      email,
      password: hashedPassword,
      authProvider: 'email', // Mark as email/password signup
    };

    // Add optional fields if provided
    if (phone) userData.phone = phone;
    if (dateOfBirth) userData.dateOfBirth = new Date(dateOfBirth).toISOString();

    // Create user
    const user = await userDb.create(userData);

    // Return success with redirect information
    return NextResponse.json(
      {
        message: 'User registered successfully',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        redirectTo: '/quizzes'
      },
      { status: 201 }
    );

  } catch (error) {
    console.error('Registration error:', error);

    // Handle Supabase unique constraint errors
    if (error instanceof Error && error.message.includes('duplicate key')) {
      securityLogger.logSuspiciousActivity(undefined, '/api/register', 'Duplicate email registration attempt', request);
      return NextResponse.json(
        { message: 'User with this email already exists' },
        { status: 409 }
      );
    }

    // Handle database connection errors
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
