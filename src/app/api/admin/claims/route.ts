import { NextRequest, NextResponse } from 'next/server';
import { getDb, prizeRedemptionDb, userDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { requireAuth } from '@/lib/auth-middleware';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { securityLogger } from '@/lib/security-logger';
import { requireCSRFToken } from '@/lib/csrf-protection';

const updateClaimSchema = z.object({
  claimId: z.string().min(1, 'Claim ID is required'),
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

    const supabase = await getDb();

    // Try RPC first
    try {
      const { data, error } = await supabase.rpc('get_admin_claims', {
        p_status: status || 'all',
        p_page: page,
        p_limit: limit
      });

      if (!error && data?.success) {
        await securityLogger.logSecurityEvent({
          type: 'ADMIN_ACCESS',
          userId: session.user.id,
          ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
          userAgent: request.headers.get('user-agent') || undefined,
          endpoint: '/api/admin/claims',
          details: {
            action: 'VIEW_CLAIMS',
            method: 'supabase_rpc',
            filters: { status, page, limit },
            resultCount: data.claims?.length || 0
          },
          severity: 'LOW'
        });

        return createSecureJsonResponse({
          claims: data.claims || [],
          pagination: data.pagination,
        });
      }
    } catch (rpcError) {
      console.warn('RPC fallback to direct query:', rpcError);
    }

    // Fallback to direct Supabase queries using admin client
    const result = await prizeRedemptionDb.findAllAdmin({
      status: status || undefined,
      page,
      limit
    });

    // Transform claims to handle Supabase FK join format
    const formattedClaims = (result.data || []).map((claim: any) => ({
      ...claim,
      user: Array.isArray(claim.User) ? claim.User[0] : claim.User,
      prize: Array.isArray(claim.Prize) ? claim.Prize[0] : claim.Prize,
    }));

    await securityLogger.logSecurityEvent({
      type: 'ADMIN_ACCESS',
      userId: session.user.id,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/admin/claims',
      details: {
        action: 'VIEW_CLAIMS',
        method: 'supabase',
        filters: { status, page, limit },
        resultCount: formattedClaims.length
      },
      severity: 'LOW'
    });

    return createSecureJsonResponse({
      claims: formattedClaims,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.count,
        totalPages: result.totalPages,
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

    // Get database client (RLS policies control access)
    const supabase = await getDb();

    // Try RPC first for rejection with refund
    if (status === 'rejected') {
      try {
        const { data: rpcResult, error: rpcError } = await supabase.rpc('reject_claim_with_refund', {
          p_claim_id: claimId,
          p_notes: notes || null
        });

        if (!rpcError && rpcResult?.success) {
          await securityLogger.logSecurityEvent({
            type: 'ADMIN_ACCESS',
            userId: session.user.id,
            ip: request.headers.get('x-forwarded-for') || 'unknown',
            userAgent: request.headers.get('user-agent') || undefined,
            endpoint: '/api/admin/claims',
            details: {
              action: 'UPDATE_CLAIM_STATUS',
              method: 'supabase_rpc',
              claimId,
              newStatus: status,
              pointsRefunded: rpcResult.points_refunded
            },
            severity: 'MEDIUM'
          });

          return createSecureJsonResponse({
            message: 'Claim rejected and points refunded',
            claim: { id: claimId, status },
          });
        }
      } catch (rpcError) {
        console.warn('RPC fallback for claim rejection:', rpcError);
      }
    }

    // Fallback to direct queries
    // Get existing claim
    const { data: existingClaim, error: fetchError } = await supabase
      .from('PrizeRedemption')
      .select(`
        *,
        User:userId (id, name, email),
        Prize:prizeId (name, pointsRequired)
      `)
      .eq('id', claimId)
      .single();

    if (fetchError || !existingClaim) {
      return NextResponse.json(
        { message: 'Claim not found' },
        { status: 404 }
      );
    }

    // Handle rejection - refund points
    if (status === 'rejected' && existingClaim.status !== 'rejected') {
      await supabase
        .from('User')
        .update({
          points: (existingClaim.User as any)?.points + existingClaim.pointsUsed,
          updatedAt: new Date().toISOString()
        })
        .eq('id', existingClaim.userId);
    }

    // Update claim status
    const { data: updatedClaim, error: updateError } = await supabase
      .from('PrizeRedemption')
      .update({
        status,
        notes: notes || existingClaim.notes,
        processedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .eq('id', claimId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Log admin action
    await securityLogger.logSecurityEvent({
      type: 'ADMIN_ACCESS',
      userId: session.user.id,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/admin/claims',
      details: {
        action: 'UPDATE_CLAIM_STATUS',
        method: 'supabase',
        claimId,
        oldStatus: existingClaim.status,
        newStatus: status,
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

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
