import { NextRequest, NextResponse } from 'next/server';
import prisma from './prisma';
import { recordSecurityEvent } from './security-monitoring';

export interface PaymentAccessResult {
  hasAccess: boolean;
  payment?: {
    id: string;
    expiresAt: Date;
    timeRemaining: number;
  };
  error?: string;
}

/**
 * Check if user has valid payment access for quizzes
 */
export async function checkPaymentAccess(
  userId: string,
  request?: NextRequest
): Promise<PaymentAccessResult> {
  try {
    const now = new Date();

    // Find active payment within 24 hours
    const activePayment = await prisma.dailyPayment.findFirst({
      where: {
        userId,
        status: 'completed',
        expiresAt: {
          gt: now
        }
      },
      orderBy: {
        expiresAt: 'desc'
      }
    });

    if (!activePayment) {
      if (request) {
        recordSecurityEvent('UNAUTHORIZED_ACCESS', request, userId, {
          reason: 'No active payment found',
        });
      }
      return {
        hasAccess: false,
        error: 'No active payment found. Please make a payment to access quizzes.'
      };
    }

    const timeRemaining = activePayment.expiresAt.getTime() - now.getTime();

    if (timeRemaining <= 0) {
      if (request) {
        recordSecurityEvent('UNAUTHORIZED_ACCESS', request, userId, {
          paymentId: activePayment.id,
          expiredAt: activePayment.expiresAt,
        });
      }
      return {
        hasAccess: false,
        error: 'Payment has expired. Please make a new payment to continue.'
      };
    }

    return {
      hasAccess: true,
      payment: {
        id: activePayment.id,
        expiresAt: activePayment.expiresAt,
        timeRemaining: Math.floor(timeRemaining / 1000) // in seconds
      }
    };

  } catch (error) {
    console.error('Payment access check error:', error);
    if (request) {
      recordSecurityEvent('SUSPICIOUS_ACTIVITY', request, userId, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    return {
      hasAccess: false,
      error: 'Failed to verify payment access'
    };
  }
}

/**
 * Middleware to require valid payment access
 */
export async function requirePaymentAccess(
  userId: string,
  request: NextRequest
): Promise<NextResponse | null> {
  const accessResult = await checkPaymentAccess(userId, request);

  if (!accessResult.hasAccess) {
    return NextResponse.json(
      { 
        error: accessResult.error || 'Payment required',
        requiresPayment: true 
      },
      { status: 402 } // Payment Required
    );
  }

  return null; // Access granted
}

/**
 * Get remaining access time for a user
 */
export async function getRemainingAccessTime(userId: string): Promise<number> {
  try {
    const now = new Date();
    const activePayment = await prisma.dailyPayment.findFirst({
      where: {
        userId,
        status: 'completed',
        expiresAt: {
          gt: now
        }
      },
      orderBy: {
        expiresAt: 'desc'
      }
    });

    if (!activePayment) {
      return 0;
    }

    const timeRemaining = activePayment.expiresAt.getTime() - now.getTime();
    return Math.max(0, Math.floor(timeRemaining / 1000)); // in seconds
  } catch (error) {
    console.error('Error getting remaining access time:', error);
    return 0;
  }
}

/**
 * Clean up expired payments (can be called periodically)
 */
export async function cleanupExpiredPayments(): Promise<number> {
  try {
    const now = new Date();
    const result = await prisma.dailyPayment.updateMany({
      where: {
        status: 'completed',
        expiresAt: {
          lt: now
        }
      },
      data: {
        status: 'expired'
      }
    });

    return result.count;
  } catch (error) {
    console.error('Error cleaning up expired payments:', error);
    return 0;
  }
}