import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { securityLogger } from '@/lib/security-logger';
import { createSecureJsonResponse } from '@/lib/security-headers';

// Input validation schema for prize redemption
const redeemPrizeSchema = z.object({
  prizeId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid prize ID format'),
});

export async function GET() {
  try {
    // Get all prizes with their 3D model data and points requirement
    const prizes = await prisma.prize.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        imageUrl: true,
        modelUrl: true,
        type: true,
        pointsRequired: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        pointsRequired: 'asc',
      },
    });

    // If no prizes exist, create some default ones with points
    if (prizes.length === 0) {
      const defaultPrizes = [
        {
          name: 'Wireless Earbuds',
          description: 'Premium wireless earbuds with noise cancellation!',
          imageUrl: '/earbuds.svg',
          modelUrl: '/models/earbuds.glb',
          type: 'earbuds',
          pointsRequired: 100,
          isActive: true,
        },
        {
          name: 'Smart Watch',
          description: 'Advanced smartwatch with health tracking!',
          imageUrl: '/smartwatch.svg',
          modelUrl: '/models/smartwatch.glb',
          type: 'watch',
          pointsRequired: 250,
          isActive: true,
        },
        {
          name: 'Android Phone',
          description: 'Latest smartphone with amazing features!',
          imageUrl: '/phone.svg',
          modelUrl: '/models/phone.glb',
          type: 'phone',
          pointsRequired: 500,
          isActive: true,
        },
        {
          name: 'CD 70 Bike',
          description: 'Win a brand new motorcycle!',
          imageUrl: '/bike.svg',
          modelUrl: '/models/bike.glb',
          type: 'bike',
          pointsRequired: 1000,
          isActive: true,
        },
      ];

      // Create default prizes
      await prisma.prize.createMany({
        data: defaultPrizes,
      });

      // Fetch the newly created prizes
      const newPrizes = await prisma.prize.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          modelUrl: true,
          type: true,
          pointsRequired: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          pointsRequired: 'asc',
        },
      });

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
      
      // Get user and prize information
      const [user, prize] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { points: true },
        }),
        prisma.prize.findUnique({
          where: { id: prizeId },
        }),
      ]);
      
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
      const existingRedemption = await prisma.prizeRedemption.findFirst({
        where: {
          userId,
          prizeId,
          status: 'pending',
        },
      });
      
      if (existingRedemption) {
        return NextResponse.json(
          { message: 'You already have a pending redemption request for this prize' },
          { status: 400 }
        );
      }
      
      // Create redemption request and deduct points in a transaction
      const redemption = await prisma.$transaction(async (tx) => {
        // Deduct points from user
        await tx.user.update({
          where: { id: userId },
          data: {
            points: {
              decrement: prize.pointsRequired,
            },
          },
        });
        
        // Create redemption request
        return await tx.prizeRedemption.create({
          data: {
            userId,
            prizeId,
            pointsUsed: prize.pointsRequired,
            status: 'pending',
          },
          include: {
            prize: true,
          },
        });
      });
      
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
        redemption,
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
    const prize = await prisma.prize.create({
      data: {
        name,
        description,
        imageUrl,
        modelUrl,
        type,
        pointsRequired: parseInt(pointsRequired),
        isActive: true,
      },
    });

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
