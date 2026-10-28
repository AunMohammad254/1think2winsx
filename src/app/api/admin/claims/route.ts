import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, prizeRedemptionDb } from '@/lib/supabase/db';
import { notifyClaimDecision } from '@/lib/claim-notifications';
import { checkHandoverCode, handoverCode, HANDOVER_MAX_FAILURES } from '@/lib/claim-tracking';
import { normalizeTrackingId } from '@/lib/claim-tracking-shared';
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

// Why an admin approves a high-risk claim, or delivers one without the winner's code (decide_claim
// wants 10 characters or more, and keeps it on the claim's timeline)
const reason = z.string().trim().min(10, 'Write at least 10 characters').max(500, 'Reason too long');

// A status change names the new status; a reissue names its mode instead (reissue_claim decides the
// status); a delivery comes with the winner's handover code or a reason there is none; reset_code
// gives the winner a new handover code
const updateClaimSchema = z.union([
  z.object({
    ...claimFields,
    action: z.literal('reissue'),
    reissueMode: z.enum(['redelivery', 'reclaim']),
  }),
  z.object({
    ...claimFields,
    action: z.literal('deliver'),
    handoverCode: z.string().regex(/^\s*\d{3}\s?\d{3}\s*$/, 'The handover code is 6 digits').optional(),
    overrideReason: reason.optional(),
  }).refine((d) => (d.handoverCode === undefined) !== (d.overrideReason === undefined), {
    message: "Enter the winner's handover code, or a reason it was delivered without one",
  }),
  z.object({
    claimId: claimFields.claimId,
    action: z.literal('reset_code'),
  }),
  z.object({
    ...claimFields,
    action: z.literal('update').optional().default('update'),
    status: z.enum(['pending', 'approved', 'rejected', 'fulfilled']),
    overrideReason: reason.optional(),
  }),
]);

// decide_claim's refusals: 409 when the admin has to do something first, 404 for an unknown claim
const DECISION_STATUS: Record<string, number> = {
  not_found: 404,
  risk_override_required: 409,
  handover_required: 409,
  code_changed: 409,
  code_locked: 423,
};

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

    // A tracking ID finds that one claim, whatever its status
    const trackingParam = searchParams.get('tracking');
    const trackingId = trackingParam ? normalizeTrackingId(trackingParam) : null;
    if (trackingParam && !trackingId) {
      return NextResponse.json({ message: 'Not a valid tracking ID. Check it for typos.' }, { status: 400 });
    }

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
        p_limit: limit,
        ...(trackingId ? { p_tracking_id: trackingId } : {}),
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
            filters: { status, page, limit, trackingId },
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
    const { claimId } = input;
    const adminEmail = session.user.email || null;
    const logAction = (details: Record<string, unknown>) => securityLogger.logSecurityEvent({
      type: 'ADMIN_ACCESS',
      userId: session.user.id,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      endpoint: '/api/admin/claims',
      details: { claimId, ...details },
      severity: 'MEDIUM'
    });

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
        p_notes: input.notes || null,
        p_admin_email: adminEmail,
      });
      if (rpcError) throw rpcError;
      if (!result?.success) {
        return NextResponse.json(
          { message: result?.error || 'Failed to reissue claim' },
          { status: result?.code === 'not_found' ? 404 : 409 }
        );
      }

      await logAction({
        action: mode === 'redelivery' ? 'REISSUE_CLAIM_REDELIVERY' : 'REISSUE_CLAIM_ALLOW_RECLAIM',
        previousStatus: result.previousStatus,
        pointsRefunded: result.pointsRefunded,
      });

      return createSecureJsonResponse({
        message: mode === 'redelivery'
          ? 'Claim reissued for re-delivery successfully'
          : 'Claim reissued. Points refunded and player may now re-claim this reward.',
        claim: { id: claimId, status: result.status },
      });
    }

    // Who to tell, and about which prize; the handover state for a delivery
    const { data: claim, error: fetchError } = await supabase
      .from('PrizeRedemption')
      .select('userId, pointsUsed, status, trackingId, handoverVersion, handoverFailures, Prize:prizeId (name)')
      .eq('id', claimId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!claim) {
      return NextResponse.json({ message: 'Claim not found' }, { status: 404 });
    }
    const prize = Array.isArray(claim.Prize) ? claim.Prize[0] : claim.Prize;
    const prizeName = prize?.name || 'the prize';

    // A new handover code: the old one stops working (reset_handover_code), and the winner sees the new
    // one on their profile
    if (input.action === 'reset_code') {
      const { data: result, error: rpcError } = await supabase.rpc('reset_handover_code', {
        p_claim_id: claimId,
        p_admin_email: adminEmail,
      });
      if (rpcError) throw rpcError;
      if (!result?.success) {
        return NextResponse.json({ message: result?.error || 'Failed to reset the code' }, { status: 409 });
      }
      const notified = await notifyClaimDecision(claim.userId, {
        status: 'code_reset', prizeName, pointsUsed: claim.pointsUsed, trackingId: claim.trackingId,
      });
      await logAction({ action: 'RESET_HANDOVER_CODE', handoverVersion: result.handoverVersion, playerNotified: notified });
      return createSecureJsonResponse({ message: 'New handover code issued. The winner sees it on their profile.', notified });
    }

    let status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
    let details: Record<string, unknown> = {};
    if (input.action === 'deliver') {
      status = 'fulfilled';
      if (input.handoverCode !== undefined) {
        // decide_claim refuses these too; checked here first so a wrong code isn't counted against a
        // claim that can't take one
        if (claim.status !== 'approved') {
          return NextResponse.json({ message: `This claim is ${claim.status}, so it can't be marked delivered` }, { status: 400 });
        }
        if (claim.handoverFailures >= HANDOVER_MAX_FAILURES) {
          return NextResponse.json(
            { message: 'Too many wrong codes. Reset the code, then ask the winner for the new one.', code: 'code_locked' },
            { status: 423 }
          );
        }
        if (!handoverCode(claimId, claim.handoverVersion)) {
          return NextResponse.json(
            { message: 'Handover codes are off: the server has neither CLAIM_HANDOVER_SECRET nor SUPABASE_SERVICE_ROLE_KEY' },
            { status: 503 }
          );
        }
        if (!checkHandoverCode(claimId, claim.handoverVersion, input.handoverCode)) {
          const { data: failure, error: failError } = await supabase.rpc('record_handover_failure', {
            p_claim_id: claimId,
            p_admin_email: adminEmail,
          });
          if (failError) throw failError;
          const failures: number = failure?.failures ?? claim.handoverFailures + 1;
          await logAction({ action: 'HANDOVER_CODE_WRONG', failures });
          return NextResponse.json({
            message: failures >= HANDOVER_MAX_FAILURES
              ? 'Wrong handover code. That was the last try: reset the code to get a new one.'
              : `Wrong handover code (${failures} of ${HANDOVER_MAX_FAILURES} tries used). Check it with the winner.`,
            code: 'wrong_code',
            failures,
          }, { status: 400 });
        }
        details = { handover: 'code', handoverVersion: claim.handoverVersion };
      } else {
        details = { handover: 'override', reason: input.overrideReason };
      }
    } else {
      status = input.status;
      if (input.overrideReason) details = { overrideReason: input.overrideReason };
    }
    const notes = input.notes;

    // decide_claim adds the risk and handover rules to the four-argument update_claim_status, which locks
    // the claim and refunds a rejection itself (supabase/migrations/20261028120000_claim_tracking.sql)
    const { data: rpcResult, error: rpcError } = await supabase.rpc('decide_claim', {
      p_claim_id: claimId,
      p_status: status,
      p_notes: notes || null,
      p_admin_email: adminEmail,
      p_details: details,
    });
    if (rpcError) throw rpcError;
    if (!rpcResult?.success) {
      return NextResponse.json(
        { message: rpcResult?.error || 'Failed to update claim', code: rpcResult?.code, risk: rpcResult?.risk },
        { status: DECISION_STATUS[rpcResult?.code ?? ''] ?? 400 }
      );
    }

    const notified = await notifyClaimDecision(claim.userId, {
      status,
      prizeName,
      pointsUsed: claim.pointsUsed,
      trackingId: claim.trackingId,
      note: notes,
    });

    await logAction({
      action: input.action === 'deliver' ? 'DELIVER_CLAIM' : 'UPDATE_CLAIM_STATUS',
      previousStatus: rpcResult.previousStatus ?? null,
      newStatus: status,
      pointsRefunded: rpcResult.pointsRefunded ?? null,
      handover: details.handover ?? null,
      riskOverride: Boolean(details.overrideReason),
      playerNotified: notified,
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
