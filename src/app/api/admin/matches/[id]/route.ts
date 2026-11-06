import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { announceMatch, loadMatch, matchView, setAiLevel, setAutoSend, setLanguage, setMaxEntries, setPublished, QUIZ_LANGUAGES } from '@/lib/match-service';
import { AI_LEVELS } from '@/lib/match-wording';
import { invalidateQuizCatalog } from '@/lib/quiz-catalog';
import { MAX_ENTRIES_LIMIT } from '@/lib/quiz-entries';

// One setting per request
const settingsSchema = z.union([
  z.object({ autoSend: z.boolean() }).strict(),
  z.object({ published: z.boolean() }).strict(),
  z.object({ maxEntries: z.number().int().min(1).max(MAX_ENTRIES_LIMIT) }).strict(),
  z.object({ language: z.enum(QUIZ_LANGUAGES as [string, ...string[]]) }).strict(),
  z.object({ aiLevel: z.enum(AI_LEVELS as [string, ...string[]]) }).strict(),
]);

/** GET /api/admin/matches/[id] - the match as the scorer console shows it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await adminApiGuard(request, '/api/admin/matches/[id]', { write: false });
  if (admin instanceof Response) return admin;
  try {
    const loaded = await loadMatch(id, Date.now(), true);
    if (!loaded) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    return createSecureJsonResponse(matchView(loaded), { status: 200 });
  } catch (error) {
    console.error('[matches] Loading failed:', error);
    return NextResponse.json({ error: 'Failed to load the match' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/matches/[id] - one of the match's settings: autoSend (Auto: each over's best questions
 * go out on ball 1, without the admin), published (Go live: players see the match and can answer; false
 * hides it again), maxEntries (how many players can join), language (both, en or ur: how players see the
 * questions) or aiLevel (full, half or off: how much Gemini words). Answers with the match as it now is.
 *
 * The first Go live tells every player, after the response (a broadcast is slow on a big user base).
 * Taking it live again after hiding it doesn't.
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
        if (outcome.data.announce) {
          const { title } = outcome.data.view.match;
          after(() => announceMatch(title).catch((error) => console.error('[matches] Announcing the match failed:', error)));
        }
      }
      result = outcome.ok ? { ok: true as const, data: outcome.data.view } : outcome;
    } else if ('maxEntries' in settings) {
      result = await setMaxEntries(id, settings.maxEntries, admin.email);
    } else if ('language' in settings) {
      result = await setLanguage(id, settings.language as Parameters<typeof setLanguage>[1], admin.email);
    } else if ('aiLevel' in settings) {
      result = await setAiLevel(id, settings.aiLevel as Parameters<typeof setAiLevel>[1], admin.email);
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
