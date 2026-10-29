import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { sendDrafts, skipDrafts } from '@/lib/match-service';
import { MAX_QUESTION_LENGTH } from '@/lib/match-wording';

const wording = z.string().trim().min(1).max(MAX_QUESTION_LENGTH);
const ids = z.array(z.string().min(1).max(100)).min(1).max(6);

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send'),
    questions: z.array(z.object({
      id: z.string().min(1).max(100),
      text: wording,
      textRomanUrdu: wording,
      // An over's runs or dot balls
      line: z.number().int().min(1).max(36).optional(),
    })).min(1).max(6),
  }),
  z.object({ action: z.literal('skip'), ids }),
]);

/**
 * POST /api/admin/matches/[id]/questions - the review of an over's questions: send them to players as the
 * admin worded them (each must keep its over and line), or skip them. Answers with the match as it now is.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await adminApiGuard(request, '/api/admin/matches/[id]/questions', { write: true });
  if (admin instanceof Response) return admin;
  try {
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: 'Invalid question review', details: body.error.issues }, { status: 400 });
    const review = body.data;
    const result = await (review.action === 'send' ? sendDrafts(id, review.questions, admin.email) : skipDrafts(id, review.ids, admin.email));
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return createSecureJsonResponse(result.data, { status: 200 });
  } catch (error) {
    console.error('[matches] Reviewing questions failed:', error);
    return NextResponse.json({ error: 'Failed to save the review' }, { status: 500 });
  }
}
