import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createSecureJsonResponse } from '@/lib/security-headers';

// GET /api/user/redemptions - Get user's prize redemption history
export async function GET() {
  try {
    // Check if NEXTAUTH_SECRET is configured
    if (!process.env.NEXTAUTH_SECRET) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Server configuration error',
          message: 'Authentication not properly configured' 
        },
        { status: 500 }
      );
    }

    // Get user session
    const session = await auth();
    
    if (!session || !session.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const userId = session.user.id;
    
    // Get user's redemption history
    const redemptions = await prisma.prizeRedemption.findMany({
      where: { userId },
      include: {
        prize: {
          select: {
            id: true,
            name: true,
            description: true,
            imageUrl: true,
            type: true,
            pointsRequired: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    
    return createSecureJsonResponse({
      success: true,
      data: redemptions,
    }, { status: 200 });
    
  } catch (error) {
    console.error('Error fetching user redemptions:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
