import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { announceMatch, loadMatch, matchView, setAutoSend, setMaxEntries, setPublished } from '@/lib/match-service';
import { invalidateQuizCatalog } from '@/lib/quiz-catalog';
import { MAX_ENTRIES_LIMIT } from '@/lib/quiz-entries';

// One setting per request
const settingsSchema = z.union([
  z.object({ autoSend: z.boolean() }).strict(),
  z.object({ published: z.boolean() }).strict(),
  z.object({ maxEntries: z.number().int().min(1).max(MAX_ENTRIES_LIMIT) }).strict(),
]);

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
 * PATCH /api/admin/matches/[id] - one of the match's settings: autoSend (questions go out as written,
 * without review), published (Go live: players see the match and can answer; false hides it again) or
 * maxEntries (how many players can join). Answers with the match as it now is.
 *
 * The first Go live tells every player, after the response (a broadcast is slow on a big user base).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await adminApiGuard(request, '/api/admin/matches/[id]', { write: true });
  if (admin instanceof Response) return admin;
  try {
    const body = settingsSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: 'Invalid match settings', details: body.error.issues }, { status: 400 });
    const settings = body.data;

    let result;
    if ('published' in settings) {
      const outcome = await setPublished(id, settings.published, admin.email);
      if (outcome.ok && outcome.data.changed) {
        // The match card shows on the quiz list now, not when the catalogue next refreshes
        invalidateQuizCatalog();
        const { match } = outcome.data.view;
        if (settings.published) {
          after(() => announceMatch(match.id, match.title).catch((error) => console.error('[matches] Announcing the match failed:', error)));
        }
      }
      result = outcome.ok ? { ok: true as const, data: outcome.data.view } : outcome;
    } else if ('maxEntries' in settings) {
      result = await setMaxEntries(id, settings.maxEntries, admin.email);
    } else {
      result = await setAutoSend(id, settings.autoSend, admin.email);
    }
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return createSecureJsonResponse(result.data, { status: 200 });
  } catch (error) {
    console.error('[matches] Saving the settings failed:', error);
    return NextResponse.json({ error: 'Failed to save the settings' }, { status: 500 });
  }
}
