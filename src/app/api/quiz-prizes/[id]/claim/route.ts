import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth-middleware';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { claimQuizPrize } from '@/lib/quiz-prizes';
import { recordClaimOrigin } from '@/lib/claim-tracking';

// The same rules claim_quiz_prize applies (and the points-redemption form uses)
const deliverySchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(100, 'Full name is too long'),
  whatsappNumber: z.string().trim().regex(/^\+?[\d\s()-]{10,15}$/, 'Enter a valid WhatsApp number'),
  address: z.string().trim().min(10, 'Enter your full delivery address').max(500, 'Address is too long'),
});

/**
 * POST /api/quiz-prizes/[id]/claim - the winner's delivery details for a prize won in a quiz ([id] is
 * the win). Creates the pending claim admins handle on the Claims screen.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: winnerId } = await params;
  try {
    const csrfResult = await requireCSRFToken(request);
    if (csrfResult) return csrfResult;

    const authResult = await requireAuth({ context: 'quiz_prize_claim' });
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.session.user.id;

    const rateLimitResponse = await applyRateLimit(rateLimiters.prizeRedemption, request, userId, '/api/quiz-prizes/[id]/claim');
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, userId, { endpoint: '/api/quiz-prizes/[id]/claim', rateLimiter: 'prizeRedemption' });
      return rateLimitResponse;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const validation = deliverySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.issues[0].message, details: validation.error.issues }, { status: 400 });
    }

    const result = await claimQuizPrize(winnerId, userId, validation.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    // For the risk flags: claims from the same IP on different accounts
    await recordClaimOrigin(result.claimId, userId, request.headers);
    return createSecureJsonResponse(
      { claimId: result.claimId, message: 'Thanks! We have your delivery details and will be in touch on WhatsApp.' },
      { status: 201 },
    );
  } catch (error) {
    console.error('Quiz prize claim error:', error);
    return NextResponse.json({ error: 'Could not save your delivery details. Please try again.' }, { status: 500 });
  }
}
