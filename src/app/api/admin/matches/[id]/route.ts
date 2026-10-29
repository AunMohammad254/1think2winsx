import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { loadMatch, matchView, setAutoSend } from '@/lib/match-service';

const settingsSchema = z.object({ autoSend: z.boolean() });

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

/**
 * PATCH /api/admin/matches/[id] - the match's settings: autoSend (questions go out as written, without
 * review). Answers with the match as it now is.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await adminApiGuard(request, '/api/admin/matches/[id]', { write: true });
  if (admin instanceof Response) return admin;
  try {
    const body = settingsSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: 'Invalid match settings', details: body.error.issues }, { status: 400 });
    const result = await setAutoSend(id, body.data.autoSend, admin.email);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return createSecureJsonResponse(result.data, { status: 200 });
  } catch (error) {
    console.error('[matches] Saving the settings failed:', error);
    return NextResponse.json({ error: 'Failed to save the settings' }, { status: 500 });
  }
}
