import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { applyMatchEvent } from '@/lib/match-service';
import { EXTRAS, MAX_RUNS_PER_BALL } from '@/lib/match-engine';

const delivery = {
  runs: z.number().int().min(0).max(MAX_RUNS_PER_BALL),
  extra: z.enum(EXTRAS as [string, ...string[]]),
  wicket: z.boolean(),
};

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start_innings'), battingTeam: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal('ball'), ...delivery }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('end_innings') }),
  z.object({ type: z.literal('close_answers') }),
  z.object({ type: z.literal('abandon') }),
  // Corrections
  z.object({ type: z.literal('correct_ball'), ballId: z.string().min(1).max(100), ...delivery }),
  z.object({ type: z.literal('resume_innings') }),
  z.object({ type: z.literal('remove_innings') }),
  z.object({ type: z.literal('reopen_answers') }),
  z.object({ type: z.literal('restore') }),
]);

const bodySchema = z.object({
  // The version the console last saw: a change made against an older one is refused
  version: z.number().int().min(0),
  event: eventSchema,
});

/**
 * POST /api/admin/matches/[id]/events - one scorer console event: start an innings, a ball, undo the
 * last ball, end the innings, close the open questions, abandon; or a correction: correct any ball,
 * resume an innings ended by hand, remove one with no balls, reopen answers closed early, restore an
 * abandoned match. Answers with the match as it now is.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await adminApiGuard(request, '/api/admin/matches/[id]/events', { write: true });
  if (admin instanceof Response) return admin;
  try {
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: 'Invalid match event', details: body.error.issues }, { status: 400 });
    const result = await applyMatchEvent(id, body.data.version, body.data.event as Parameters<typeof applyMatchEvent>[2], admin.email);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return createSecureJsonResponse(result.data, { status: 200 });
  } catch (error) {
    console.error('[matches] Applying an event failed:', error);
    return NextResponse.json({ error: 'Failed to save the change' }, { status: 500 });
  }
}
