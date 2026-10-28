import { NextRequest, NextResponse } from 'next/server';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { loadMatch, matchView } from '@/lib/match-service';

/** GET /api/admin/matches/[id] - the match as the scorer console shows it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await adminApiGuard(request, '/api/admin/matches/[id]', { write: false });
  if (admin instanceof Response) return admin;
  try {
    const loaded = await loadMatch(id);
    if (!loaded) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    return createSecureJsonResponse(matchView(loaded), { status: 200 });
  } catch (error) {
    console.error('[matches] Loading failed:', error);
    return NextResponse.json({ error: 'Failed to load the match' }, { status: 500 });
  }
}
