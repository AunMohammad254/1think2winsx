/* v8 ignore next -- an import line has no logic; Vitest's rewrite of it reports a phantom branch */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { getSettlementDetail, listSettlementQuizzes, notifySettlement, runSettlement, settleResultForBrowser } from '@/lib/quiz-settlement';
import { poolPercentSchema, rewardsSchema, settleErrorStatus } from './schema';
import logger from '@/lib/logger';

const ENDPOINT = '/api/admin/quiz-settlement';

const settleSchema = z.object({
  quizId: z.string().min(1),
  rewards: rewardsSchema,
  tieRule: z.enum(['random', 'earliest']),
  // The seed the preview was made with, so the settled winners and pool shares are the previewed ones
  seed: z.string().min(16).max(128),
  poolPercent: poolPercentSchema,
});

/**
 * GET /api/admin/quiz-settlement           every quiz with its stage, and the prizes that can be won
 * GET /api/admin/quiz-settlement?quizId=…  one quiz: its questions and saved result, and its winners once settled
 */
export async function GET(request: NextRequest) {
  const admin = await adminApiGuard(request, ENDPOINT, { write: false });
  if (admin instanceof Response) return admin;
  try {
    const quizId = request.nextUrl.searchParams.get('quizId');
    if (!quizId) return createSecureJsonResponse(await listSettlementQuizzes(Date.now()), { status: 200 });
    const detail = await getSettlementDetail(quizId, Date.now());
    if (!detail) return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
    return createSecureJsonResponse(detail, { status: 200 });
  } catch (error) {
    console.error('[quiz-settlement] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load quiz settlement' }, { status: 500 });
  }
}

/**
 * POST /api/admin/quiz-settlement - settle a quiz: pay 1st-3rd place their points or prizes, once.
 * Everything happens in one database transaction; then winners and players are notified.
 */
export async function POST(request: NextRequest) {
  const admin = await adminApiGuard(request, ENDPOINT, { write: true });
  if (admin instanceof Response) return admin;
  try {
    const parsed = settleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const result = await runSettlement({ ...parsed.data, settledBy: admin.email, dryRun: false });
    if (!result.success) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: settleErrorStatus(result.code) });
    }
    logger.log(`[quiz-settlement] ${result.quizId} settled by ${admin.email}: ${result.winners.length} winner(s), ` +
      `${result.pool?.paid ?? 0} pool points to ${result.pool?.recipients ?? 0} player(s)`);
    const notified = await notifySettlement(result);
    return createSecureJsonResponse({ result: settleResultForBrowser(result), notified }, { status: 200 });
  } catch (error) {
    console.error('[quiz-settlement] Settling failed:', error);
    return NextResponse.json({ error: 'Failed to settle the quiz' }, { status: 500 });
  }
}
