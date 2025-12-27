import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prizeDb, userDb, prizeRedemptionDb, getDb, generateId } from '@/lib/supabase/db';
import { z } from 'zod';
import { securityLogger } from '@/lib/security-logger';
import { createSecureJsonResponse } from '@/lib/security-headers';

// Input validation schema for prize redemption
const redeemPrizeSchema = z.object({
  prizeId: z.string().min(1, 'Prize ID is required'),
});

export async function GET() {
  try {
    const supabase = await getDb();

    // Get all active prizes
    const { data: prizes, error } = await supabase
      .from('Prize')
      .select('id, name, description, imageUrl, modelUrl, type, pointsRequired, isActive, createdAt, updatedAt')
      .eq('isActive', true)
      .order('pointsRequired', { ascending: true });

    if (error) throw error;

    // If no prizes exist, create some default ones with points
    if (!prizes || prizes.length === 0) {
      const defaultPrizes = [
        {
          id: generateId(),
          name: 'Wireless Earbuds',
          description: 'Premium wireless earbuds with noise cancellation!',
          imageUrl: '/earbuds.svg',
          modelUrl: '/models/earbuds.glb',
          type: 'earbuds',
          pointsRequired: 100,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: generateId(),
          name: 'Smart Watch',
          description: 'Advanced smartwatch with health tracking!',
          imageUrl: '/smartwatch.svg',
          modelUrl: '/models/smartwatch.glb',
          type: 'watch',
          pointsRequired: 250,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: generateId(),
          name: 'Android Phone',
          description: 'Latest smartphone with amazing features!',
          imageUrl: '/phone.svg',
          modelUrl: '/models/phone.glb',
          type: 'phone',
          pointsRequired: 500,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: generateId(),
          name: 'CD 70 Bike',
          description: 'Win a brand new motorcycle!',
          imageUrl: '/bike.svg',
          modelUrl: '/models/bike.glb',
          type: 'bike',
          pointsRequired: 1000,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      // Create default prizes
      const { error: insertError } = await supabase
        .from('Prize')
        .insert(defaultPrizes);

      if (insertError) throw insertError;

      // Fetch the newly created prizes
      const { data: newPrizes } = await supabase
        .from('Prize')
        .select('id, name, description, imageUrl, modelUrl, type, pointsRequired, isActive, createdAt, updatedAt')
        .eq('isActive', true)
        .order('pointsRequired', { ascending: true });

      return createSecureJsonResponse({
        success: true,
        data: newPrizes,
        message: 'Prizes retrieved successfully',
      });
    }

    return createSecureJsonResponse({
      success: true,
      data: prizes,
      message: 'Prizes retrieved successfully',
    });
  } catch (error) {
    console.error('Error fetching prizes:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch prizes',
        message: 'An error occurred while retrieving prizes',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();

    if (!session || !session.user) {
      securityLogger.logUnauthorizedAccess(undefined, '/api/prizes', request);
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required',
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { action } = body;

    // Handle prize redemption
    if (action === 'redeem') {
      const userId = session.user.id;

      // Validate input
      const validationResult = redeemPrizeSchema.safeParse(body);
      if (!validationResult.success) {
        securityLogger.logInvalidInput(userId, '/api/prizes', validationResult.error.errors, request);
        return NextResponse.json(
          { message: 'Invalid input', errors: validationResult.error.errors },
          { status: 400 }
        );
      }

      const { prizeId } = validationResult.data;
      const supabase = await getDb();

      // Get user and prize information
      const [userResult, prizeResult] = await Promise.all([
        supabase.from('User').select('points').eq('id', userId).single(),
        supabase.from('Prize').select('*').eq('id', prizeId).single(),
      ]);

      const user = userResult.data;
      const prize = prizeResult.data;

      if (!user) {
        return NextResponse.json(
          { message: 'User not found' },
          { status: 404 }
        );
      }

      if (!prize || !prize.isActive) {
        return NextResponse.json(
          { message: 'Prize not found or not available' },
          { status: 404 }
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

      // Check for existing pending redemption
      const { data: existingRedemption } = await supabase
        .from('PrizeRedemption')
        .select('id')
        .eq('userId', userId)
        .eq('prizeId', prizeId)
        .eq('status', 'pending')
        .single();

      if (existingRedemption) {
        return NextResponse.json(
          { message: 'You already have a pending redemption request for this prize' },
          { status: 400 }
        );
      }

      // Use RPC function for atomic redemption (if exists), otherwise manual transaction
      const { data: rpcResult, error: rpcError } = await supabase.rpc('redeem_prize', {
        p_user_id: userId,
        p_prize_id: prizeId,
      });

      if (rpcError) {
        // Fallback to manual operations if RPC doesn't exist
        if (rpcError.message?.includes('function') || rpcError.code === '42883') {
          // Deduct points from user
          await supabase
            .from('User')
            .update({
              points: user.points - prize.pointsRequired,
              updatedAt: new Date().toISOString()
            })
            .eq('id', userId);

          // Create redemption request
          const redemptionId = generateId();
          const { data: redemption, error: redemptionError } = await supabase
            .from('PrizeRedemption')
            .insert({
              id: redemptionId,
              userId,
              prizeId,
              pointsUsed: prize.pointsRequired,
              status: 'pending',
              requestedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .select(`*, Prize:prizeId (*)`)
            .single();

          if (redemptionError) throw redemptionError;

          // Log the redemption request
          securityLogger.logSecurityEvent({
            type: 'SUSPICIOUS_ACTIVITY',
            userId,
            endpoint: '/api/prizes',
            details: {
              action: 'prize_redemption_request',
              prizeId,
              pointsUsed: prize.pointsRequired,
            },
          });

          return createSecureJsonResponse({
            success: true,
            redemption: {
              ...redemption,
              prize: Array.isArray(redemption.Prize) ? redemption.Prize[0] : redemption.Prize
            },
            message: 'Prize redemption request submitted successfully',
          }, { status: 201 });
        }
        throw rpcError;
      }

      if (rpcResult && !rpcResult.success) {
        return NextResponse.json(
          { message: rpcResult.error || 'Redemption failed' },
          { status: 400 }
        );
      }

      // Log the redemption request
      securityLogger.logSecurityEvent({
        type: 'SUSPICIOUS_ACTIVITY',
        userId,
        endpoint: '/api/prizes',
        details: {
          action: 'prize_redemption_request',
          prizeId,
          pointsUsed: prize.pointsRequired,
          redemptionId: rpcResult?.redemption_id,
        },
      });

      return createSecureJsonResponse({
        success: true,
        redemption: {
          id: rpcResult?.redemption_id,
          pointsUsed: rpcResult?.points_used,
          newBalance: rpcResult?.new_balance,
          prize,
        },
        message: 'Prize redemption request submitted successfully',
      }, { status: 201 });
    }

    // Handle admin prize creation
    // Check if user is admin
    const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [];
    const isAdmin = adminEmails.includes(session.user.email || '');

    if (!isAdmin) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Admin access required',
        },
        { status: 403 }
      );
    }

    const { name, description, imageUrl, modelUrl, type, pointsRequired } = body;

    // Validate required fields
    if (!name || !type || !pointsRequired) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields',
          message: 'Name, type, and pointsRequired are required',
        },
        { status: 400 }
      );
    }

    // Create new prize
    const supabase = await getDb();
    const { data: prize, error: createError } = await supabase
      .from('Prize')
      .insert({
        id: generateId(),
        name,
        description,
        imageUrl,
        modelUrl,
        type,
        pointsRequired: parseInt(pointsRequired),
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) throw createError;

    return NextResponse.json(
      {
        success: true,
        data: prize,
        message: 'Prize created successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error processing prize request:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process request',
        message: 'An error occurred while processing the request',
      },
      { status: 500 }
    );
  }
}
