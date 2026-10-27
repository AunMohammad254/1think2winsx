/* v8 ignore next -- an import line has no logic; Vitest's rewrite of it reports a phantom branch */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { runSettlement, settleResultForBrowser } from '@/lib/quiz-settlement';
import { poolEachSchema, poolPercentSchema, rewardsSchema, settleErrorStatus } from '../schema';

const previewSchema = z.object({
  quizId: z.string().min(1),
  rewards: rewardsSchema,
  tieRule: z.enum(['random', 'earliest']),
  // Reuse the seed of an earlier preview to keep a random tie-break (and the pool shares) stable while editing
  seed: z.string().min(16).max(128).optional(),
  poolPercent: poolPercentSchema,
  poolEach: poolEachSchema,
});

/**
 * POST /api/admin/quiz-settlement/preview - who would win, and what, without changing anything.
 * Runs the real settle_quiz and rolls it back, so settling with the returned seed gives exactly this.
 */
export async function POST(request: NextRequest) {
  const admin = await adminApiGuard(request, '/api/admin/quiz-settlement/preview', { write: true });
  if (admin instanceof Response) return admin;
  try {
    const parsed = previewSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const seed = parsed.data.seed ?? randomBytes(16).toString('hex');
    const result = await runSettlement({ ...parsed.data, seed, settledBy: admin.email, dryRun: true });
    if (!result.success) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: settleErrorStatus(result.code) });
    }
    return createSecureJsonResponse({ result: settleResultForBrowser(result) }, { status: 200 });
  } catch (error) {
    console.error('[quiz-settlement] Preview failed:', error);
    return NextResponse.json({ error: 'Failed to preview the winners' }, { status: 500 });
  }
}
