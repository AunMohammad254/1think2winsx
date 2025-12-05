import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { requireAuth } from '@/lib/auth-middleware';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { securityLogger } from '@/lib/security-logger';
import { requireCSRFToken } from '@/lib/csrf-protection';

const updateClaimSchema = z.object({
  claimId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid claim ID format'),
  status: z.enum(['pending', 'approved', 'rejected', 'fulfilled']),
  notes: z.string().max(500, 'Notes too long').optional(),
});

// GET /api/admin/claims - Get all prize claims for admin
export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      undefined,
      '/api/admin/claims'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, undefined, {
        endpoint: '/api/admin/claims',
        rateLimiter: 'admin'
      });
      return rateLimitResponse;
    }

    // Use requireAuth middleware for admin authentication
    const authResult = await requireAuth({ adminOnly: true, context: '/api/admin/claims' });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const session = authResult.session;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;

    // Build where clause with input validation
    const whereClause: { status?: string } = {};
    if (status && ['pending', 'approved', 'rejected', 'fulfilled'].includes(status)) {
      whereClause.status = status;
    }

    // Get claims with pagination
    const [claims, totalCount] = await Promise.all([
      prisma.prizeRedemption.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              points: true,
            },
          },
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
        orderBy: { requestedAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.prizeRedemption.count({ where: whereClause }),
    ]);

    // Log admin access
    await securityLogger.logSecurityEvent({
      type: 'ADMIN_ACCESS',
      userId: session.user.id,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/admin/claims',
      details: { 
        action: 'VIEW_CLAIMS',
        filters: { status, page, limit },
        resultCount: claims.length
      },
      severity: 'LOW'
    });

    return createSecureJsonResponse({
      claims,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });

  } catch (error) {
    console.error('Error fetching claims:', error);
    
    await securityLogger.logSecurityEvent({
      type: 'API_ERROR',
      userId: undefined,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/admin/claims',
      details: { 
        error: error instanceof Error ? error.message : 'Unknown error',
        action: 'GET_CLAIMS'
      },
      severity: 'MEDIUM'
    });

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/claims - Update claim status
export async function PUT(request: NextRequest) {
  try {
    // Apply CSRF protection for state-changing operations
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      undefined,
      '/api/admin/claims'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, undefined, {
        endpoint: '/api/admin/claims',
        rateLimiter: 'admin'
      });
      return rateLimitResponse;
    }

    // Use requireAuth middleware for admin authentication
    const authResult = await requireAuth({ adminOnly: true, context: '/api/admin/claims' });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const session = authResult.session;

    const body = await request.json();
    
    // Validate input with proper error handling
    const validationResult = updateClaimSchema.safeParse(body);
    if (!validationResult.success) {
      securityLogger.logInvalidInput(authResult.user.id, '/api/admin/claims', validationResult.error.errors, request);
      return NextResponse.json(
        { message: 'Invalid input', errors: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { claimId, status, notes } = validationResult.data;

    // Check if claim exists
    const existingClaim = await prisma.prizeRedemption.findUnique({
      where: { id: claimId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        prize: {
          select: {
            name: true,
            pointsRequired: true,
          },
        },
      },
    });

    if (!existingClaim) {
      return NextResponse.json(
        { message: 'Claim not found' },
        { status: 404 }
      );
    }

    // Update claim status
    const updatedClaim = await prisma.prizeRedemption.update({
      where: { id: claimId },
      data: {
        status,
        notes: notes || existingClaim.notes,
        processedAt: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        prize: {
          select: {
            name: true,
            pointsRequired: true,
          },
        },
      },
    });

    // Log admin action
    await securityLogger.logSecurityEvent({
      type: 'ADMIN_ACCESS',
      userId: session.user.id,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/admin/claims',
      details: { 
        action: 'UPDATE_CLAIM_STATUS',
        claimId,
        oldStatus: existingClaim.status,
        newStatus: status,
        userId: existingClaim.user.id,
        prizeName: existingClaim.prize.name,
        notes: notes || ''
      },
      severity: 'MEDIUM'
    });

    return createSecureJsonResponse({
      message: 'Claim status updated successfully',
      claim: {
        id: updatedClaim.id,
        status: updatedClaim.status,
        processedAt: updatedClaim.processedAt,
        notes: updatedClaim.notes,
      },
    });

  } catch (error) {
    console.error('Error updating claim:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: 'Invalid input data', errors: error.errors },
        { status: 400 }
      );
    }

    await securityLogger.logSecurityEvent({
      type: 'API_ERROR',
      userId: undefined,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/admin/claims',
      details: { 
        error: error instanceof Error ? error.message : 'Unknown error',
        action: 'UPDATE_CLAIM'
      },
      severity: 'MEDIUM'
    });

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
