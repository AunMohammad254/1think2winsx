import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, prizeRedemptionDb } from '@/lib/supabase/db';
import { notifyClaimDecision } from '@/lib/claim-notifications';
import { z } from 'zod';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { requireAuth } from '@/lib/auth-middleware';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { securityLogger } from '@/lib/security-logger';
import { requireCSRFToken } from '@/lib/csrf-protection';

const claimFields = {
  claimId: z.string().min(1, 'Claim ID is required'),
  notes: z.string().max(500, 'Notes too long').optional(),
};

// A status change names the new status; a reissue names its mode instead (reissue_claim decides the status)
const updateClaimSchema = z.union([
  z.object({
    ...claimFields,
    action: z.literal('reissue'),
    reissueMode: z.enum(['redelivery', 'reclaim']),
  }),
  z.object({
    ...claimFields,
    action: z.literal('update').optional().default('update'),
    status: z.enum(['pending', 'approved', 'rejected', 'fulfilled']),
  }),
]);

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

    const supabase = getAdminDb();

    // The status tiles show totals, not just the page returned here; a failed count
    // should not take the claim list down with it
    const statusCounts = await prizeRedemptionDb.countByStatus().catch((countError) => {
      console.warn('Failed to count claims by status:', countError);
      return null;
    });

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
          statusCounts,
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
      statusCounts,
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
      securityLogger.logInvalidInput(authResult.user.id, '/api/admin/claims', validationResult.error.issues, request);
      return NextResponse.json(
        { message: 'Invalid input', errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    const input = validationResult.data;
    const { claimId, notes } = input;

    // Get database client
    const supabase = getAdminDb();

    // Reissue an approved or delivered claim: send it again ('redelivery') or refund it so the player
    // can claim again ('reclaim'). reissue_claim checks the status and moves points and stock in one
    // locked transaction (db-tests/schema/06-20261019181000_prize_claim_once_and_reissue.sql).
    if (input.action === 'reissue') {
      const mode = input.reissueMode;
      const { data: result, error: rpcError } = await supabase.rpc('reissue_claim', {
        p_claim_id: claimId,
        p_mode: mode,
        p_notes: notes || null,
        p_admin_email: session.user.email || null,
      });
      if (rpcError) throw rpcError;
      if (!result?.success) {
        return NextResponse.json(
          { message: result?.error || 'Failed to reissue claim' },
          { status: result?.code === 'not_found' ? 404 : 409 }
        );
      }

      await securityLogger.logSecurityEvent({
        type: 'ADMIN_ACCESS',
        userId: session.user.id,
        ip: request.headers.get('x-forwarded-for') || 'unknown',
        userAgent: request.headers.get('user-agent') || undefined,
        endpoint: '/api/admin/claims',
        details: {
          action: mode === 'redelivery' ? 'REISSUE_CLAIM_REDELIVERY' : 'REISSUE_CLAIM_ALLOW_RECLAIM',
          claimId,
          previousStatus: result.previousStatus,
          pointsRefunded: result.pointsRefunded,
        },
        severity: 'MEDIUM'
      });

      return createSecureJsonResponse({
        message: mode === 'redelivery'
          ? 'Claim reissued for re-delivery successfully'
          : 'Claim reissued. Points refunded and player may now re-claim this reward.',
        claim: { id: claimId, status: result.status },
      });
    }

    const { status } = input;

    // Who to tell, and about which prize: update_claim_status returns only the outcome
    const { data: claim, error: fetchError } = await supabase
      .from('PrizeRedemption')
      .select('userId, pointsUsed, Prize:prizeId (name)')
      .eq('id', claimId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!claim) {
      return NextResponse.json({ message: 'Claim not found' }, { status: 404 });
    }

    // All four arguments named, so only the four-argument update_claim_status matches. With three,
    // PostgREST couldn't choose between the two overloads production had and answered HTTP 300; the old
    // fallbacks (approve_claim and friends) check is_admin(), which a server call never passes, so every
    // decision failed with "Unauthorized". The function locks the claim and refunds a rejection itself
    // (db-tests/schema/06-20261021180000_update_claim_status_single.sql).
    const { data: rpcResult, error: rpcError } = await supabase.rpc('update_claim_status', {
      p_claim_id: claimId,
      p_status: status,
      p_notes: notes || null,
      p_admin_email: session.user.email || null,
    });
    if (rpcError) throw rpcError;
    if (!rpcResult?.success) {
      return NextResponse.json(
        { message: rpcResult?.error || 'Failed to update claim' },
        { status: rpcResult?.code === 'not_found' ? 404 : 400 }
      );
    }

    const prize = Array.isArray(claim.Prize) ? claim.Prize[0] : claim.Prize;
    const notified = await notifyClaimDecision(claim.userId, {
      status,
      prizeName: prize?.name || 'the prize',
      pointsUsed: claim.pointsUsed,
      note: notes,
    });

    await securityLogger.logSecurityEvent({
      type: 'ADMIN_ACCESS',
      userId: session.user.id,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/admin/claims',
      details: {
        action: 'UPDATE_CLAIM_STATUS',
        claimId,
        previousStatus: rpcResult.previousStatus ?? null,
        newStatus: status,
        pointsRefunded: rpcResult.pointsRefunded ?? null,
        playerNotified: notified,
      },
      severity: 'MEDIUM'
    });

    return createSecureJsonResponse({
      message: `Claim ${status} successfully`,
      claim: { id: claimId, status },
      notified,
    });

  } catch (error) {
    console.error('Error updating claim:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: 'Invalid input data', errors: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
