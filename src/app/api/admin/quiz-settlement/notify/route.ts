/* v8 ignore next -- an import line has no logic; Vitest's rewrite of it reports a phantom branch */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { resendSettlementNotices } from '@/lib/quiz-settlement';
import { logQuizAction } from '@/lib/admin-action-log';

const notifySchema = z.object({ quizId: z.string().min(1) });

/**
 * POST /api/admin/quiz-settlement/notify - send a settled quiz's notices again, to the players who
 * don't have theirs yet (settling pays first and notifies after, so notifying can fail on its own).
 */
export async function POST(request: NextRequest) {
  const admin = await adminApiGuard(request, '/api/admin/quiz-settlement/notify', { write: true });
  if (admin instanceof Response) return admin;
  try {
    const parsed = notifySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const outcome = await resendSettlementNotices(parsed.data.quizId);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
    await logQuizAction({ quizId: parsed.data.quizId, action: 'notices_resent', adminEmail: admin.email, details: { notified: outcome.notified } });
    return NextResponse.json({ notified: outcome.notified }, { status: 200 });
  } catch (error) {
    console.error('[quiz-settlement] Sending the notices again failed:', error);
    return NextResponse.json({ error: 'Failed to send the notices' }, { status: 500 });
  }
}
