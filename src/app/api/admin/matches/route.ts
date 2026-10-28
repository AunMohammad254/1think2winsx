import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { createMatch, listMatches } from '@/lib/match-service';

const newMatchSchema = z.object({
  teamA: z.string().trim().min(2, 'Each team name needs 2 to 60 characters').max(60, 'Each team name needs 2 to 60 characters'),
  teamB: z.string().trim().min(2, 'Each team name needs 2 to 60 characters').max(60, 'Each team name needs 2 to 60 characters'),
  // T20 or T10
  oversPerInnings: z.union([z.literal(20), z.literal(10)]),
  questionsPerOver: z.number().int().min(1).max(3).default(2),
});

/** GET /api/admin/matches - the newest live matches (Live Matches screen). */
export async function GET(request: NextRequest) {
  const admin = await adminApiGuard(request, '/api/admin/matches', { write: false });
  if (admin instanceof Response) return admin;
  try {
    return createSecureJsonResponse({ matches: await listMatches() }, { status: 200 });
  } catch (error) {
    console.error('[matches] Listing failed:', error);
    return NextResponse.json({ error: 'Failed to load the matches' }, { status: 500 });
  }
}

/** POST /api/admin/matches - a new match and its draft quiz: { teamA, teamB, oversPerInnings, questionsPerOver }. */
export async function POST(request: NextRequest) {
  const admin = await adminApiGuard(request, '/api/admin/matches', { write: true });
  if (admin instanceof Response) return admin;
  try {
    const body = newMatchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: body.error.issues[0].message }, { status: 400 });
    const result = await createMatch(body.data, admin.email);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return createSecureJsonResponse(result.data, { status: 201 });
  } catch (error) {
    console.error('[matches] Creating failed:', error);
    return NextResponse.json({ error: 'Failed to create the match' }, { status: 500 });
  }
}
