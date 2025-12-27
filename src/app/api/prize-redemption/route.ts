import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb, userDb, prizeDb, prizeRedemptionDb, generateId } from '@/lib/supabase/db';
import { z } from 'zod';
import { securityLogger } from '@/lib/security-logger';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';

const redeemPrizeSchema = z.object({
  prizeId: z.string().min(1, 'Prize ID is required'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100, 'Full name too long').optional(),
  whatsappNumber: z.string().regex(/^\+?[\d\s-()]{10,15}$/, 'Invalid WhatsApp number format').optional(),
  address: z.string().min(10, 'Address must be at least 10 characters').max(500, 'Address too long').optional(),
});

// POST /api/prize-redemption - Redeem a prize with points
export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection for state-changing operations
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    // Apply rate limiting for prize redemption
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.prizeRedemption,
      request,
      undefined,
      '/api/prize-redemption'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, undefined, {
        endpoint: '/api/prize-redemption',
        rateLimiter: 'prizeRedemption'
      });
      return rateLimitResponse;
    }

    const session = await auth();

    if (!session || !session.user) {
      securityLogger.logUnauthorizedAccess(undefined, '/api/prize-redemption', request);
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate input with proper error handling
    const validationResult = redeemPrizeSchema.safeParse(body);
    if (!validationResult.success) {
      securityLogger.logInvalidInput(session.user.id, '/api/prize-redemption', validationResult.error.errors, request);
      return NextResponse.json(
        { message: 'Invalid input', errors: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { prizeId, fullName, whatsappNumber, address } = validationResult.data;
    const supabase = await getDb();

    // Get user's current points by email
    if (!session.user.email) {
      return NextResponse.json(
        { message: 'User email not found in session' },
        { status: 400 }
      );
    }

    const { data: user, error: userError } = await supabase
      .from('User')
      .select('id, points')
      .eq('email', session.user.email)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { message: 'User not found. Please ensure your account is synced.' },
        { status: 404 }
      );
    }

    // Get prize details
    const { data: prize, error: prizeError } = await supabase
      .from('Prize')
      .select('id, name, description, imageUrl, pointsRequired, isActive, stock')
      .eq('id', prizeId)
      .single();

    if (prizeError || !prize || !prize.isActive) {
      return NextResponse.json(
        { message: 'Prize not found or not available' },
        { status: 404 }
      );
    }

    // Check if prize is in stock
    if (prize.stock !== null && prize.stock <= 0) {
      return NextResponse.json(
        { message: 'This prize is currently out of stock' },
        { status: 400 }
      );
    }

    // Check if user has enough points
    if (user.points < prize.pointsRequired) {
      return NextResponse.json(
        {
          message: 'Insufficient points',
          required: prize.pointsRequired,
          available: user.points,
        },
        { status: 400 }
      );
    }

    // Use RPC function for atomic redemption
    const { data: rpcResult, error: rpcError } = await supabase.rpc('redeem_prize', {
      p_user_id: user.id,
      p_prize_id: prizeId,
      p_full_name: fullName || null,
      p_whatsapp_number: whatsappNumber || null,
      p_address: address || null,
    });

    if (rpcError) {
      // Fallback to manual operations if RPC doesn't exist
      if (rpcError.message?.includes('function') || rpcError.code === '42883') {
        const redemptionId = generateId();

        // Deduct points from user
        await supabase
          .from('User')
          .update({
            points: user.points - prize.pointsRequired,
            updatedAt: new Date().toISOString()
          })
          .eq('id', user.id);

        // Decrement stock if applicable
        if (prize.stock !== null && prize.stock > 0) {
          await supabase
            .from('Prize')
            .update({
              stock: prize.stock - 1,
              updatedAt: new Date().toISOString()
            })
            .eq('id', prizeId);
        }

        // Create redemption request
        const { data: redemption, error: redemptionError } = await supabase
          .from('PrizeRedemption')
          .insert({
            id: redemptionId,
            userId: user.id,
            prizeId: prizeId,
            pointsUsed: prize.pointsRequired,
            status: 'pending',
            fullName: fullName || null,
            whatsappNumber: whatsappNumber || null,
            address: address || null,
            requestedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .select()
          .single();

        if (redemptionError) throw redemptionError;

        // Log successful prize redemption
        securityLogger.logSecurityEvent({
          type: 'PRIZE_REDEMPTION',
          userId: session.user.id,
          ip: request.headers.get('x-forwarded-for') || 'unknown',
          userAgent: request.headers.get('user-agent') || undefined,
          endpoint: '/api/prize-redemption',
          details: {
            prizeId,
            prizeName: prize.name,
            pointsUsed: prize.pointsRequired
          },
          severity: 'LOW'
        });

        return createSecureJsonResponse({
          message: 'Prize redeemed successfully',
          redemption: {
            id: redemption.id,
            prizeName: prize.name,
            pointsUsed: prize.pointsRequired,
            status: 'pending',
            requestedAt: redemption.requestedAt,
          },
        }, { status: 201 });
      }
      throw rpcError;
    }

    if (rpcResult && !rpcResult.success) {
      return NextResponse.json(
        {
          message: rpcResult.error || 'Redemption failed',
          required: rpcResult.required,
          available: rpcResult.available,
        },
        { status: 400 }
      );
    }

    // Log successful prize redemption
    securityLogger.logSecurityEvent({
      type: 'PRIZE_REDEMPTION',
      userId: session.user.id,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/prize-redemption',
      details: {
        prizeId,
        prizeName: prize.name,
        pointsUsed: rpcResult?.points_used || prize.pointsRequired,
        redemptionId: rpcResult?.redemption_id
      },
      severity: 'LOW'
    });

    return createSecureJsonResponse({
      message: 'Prize redeemed successfully',
      redemption: {
        id: rpcResult?.redemption_id,
        prizeName: prize.name,
        pointsUsed: rpcResult?.points_used || prize.pointsRequired,
        status: 'pending',
        newBalance: rpcResult?.new_balance,
      },
    }, { status: 201 });

  } catch (error) {
    console.error('Error redeeming prize:', error);

    securityLogger.logSecurityEvent({
      type: 'API_ERROR',
      userId: undefined,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/prize-redemption',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        action: 'REDEEM_PRIZE'
      },
      severity: 'MEDIUM'
    });

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: 'Invalid input data', errors: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/prize-redemption - Get user's redemption history
export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting for GET requests
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.general,
      request,
      undefined,
      '/api/prize-redemption'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, undefined, {
        endpoint: '/api/prize-redemption',
        rateLimiter: 'general'
      });
      return rateLimitResponse;
    }

    const session = await auth();

    if (!session || !session.user || !session.user.email) {
      securityLogger.logUnauthorizedAccess(undefined, '/api/prize-redemption', request);
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = await getDb();

    // Look up user by email
    const { data: user } = await supabase
      .from('User')
      .select('id')
      .eq('email', session.user.email)
      .single();

    if (!user) {
      return NextResponse.json(
        { message: 'User not found. Please ensure your account is synced.', redemptions: [] },
        { status: 200 }
      );
    }

    const { data: redemptions, error } = await supabase
      .from('PrizeRedemption')
      .select(`
        *,
        Prize:prizeId (name, description, imageUrl, type)
      `)
      .eq('userId', user.id)
      .order('requestedAt', { ascending: false });

    if (error) throw error;

    // Format redemptions
    const formattedRedemptions = (redemptions || []).map((r: any) => ({
      ...r,
      prize: Array.isArray(r.Prize) ? r.Prize[0] : r.Prize
    }));

    return createSecureJsonResponse({ redemptions: formattedRedemptions });

  } catch (error) {
    console.error('Error fetching redemption history:', error);

    securityLogger.logSecurityEvent({
      type: 'API_ERROR',
      userId: undefined,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/prize-redemption',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        action: 'GET_REDEMPTION_HISTORY'
      },
      severity: 'MEDIUM'
    });

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
