/* v8 ignore next -- an import line has no logic; Vitest's rewrite of it reports a phantom branch */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { saveQuizResult } from '@/lib/quiz-settlement';

const resultSchema = z.object({
  quizId: z.string().min(1),
  // questionId -> index of the correct option
  answers: z.record(z.string(), z.number().int().min(0).max(9)),
  // The admin's explicit "End quiz now": saving a result closes the questions to new answers
  endNow: z.boolean().optional(),
});

/** POST /api/admin/quiz-settlement/result - save the quiz's result (the correct option of each question). */
export async function POST(request: NextRequest) {
  const admin = await adminApiGuard(request, '/api/admin/quiz-settlement/result', { write: true });
  if (admin instanceof Response) return admin;
  try {
    const parsed = resultSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const outcome = await saveQuizResult(parsed.data.quizId, parsed.data.answers, parsed.data.endNow === true, Date.now());
    if (!outcome.ok) return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('[quiz-settlement] Saving the result failed:', error);
    return NextResponse.json({ error: 'Failed to save the result' }, { status: 500 });
  }
}
