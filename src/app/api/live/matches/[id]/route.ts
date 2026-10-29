/* v8 ignore next -- an import line has no logic; Vitest's rewrite of it reports a phantom branch */
import { NextResponse } from 'next/server';
import { getPublicMatch } from '@/lib/match-feed';
import { createSecureJsonResponse } from '@/lib/security-headers';

// Like /api/live: browsers always ask again, Cloudflare keeps the answer 3 s (needs the Cache Rule for
// /api/live/matches/). A ball changes what players see, so the copy stays short-lived.
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=0, s-maxage=3, stale-while-revalidate=3' };
// Refusals are never cached: a match taken live a moment later must not stay "not found"
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/live/matches/[id] - a live match as players see it (src/lib/match-feed.ts): the score and the
 * questions sent so far. No sign-in and nothing per player, so one cached copy serves everyone watching;
 * the match screen polls it every few seconds. A player's own answers come from the signed-in
 * /api/quizzes/[id]/answers, and answering goes through the signed-in submit route.
 *
 * `serverNow` is the time of this response: a copy Cloudflare kept is older by its Age header.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const match = await getPublicMatch(id);
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404, headers: NO_STORE });
    return createSecureJsonResponse({ ...match, serverNow: new Date().toISOString() }, { status: 200, headers: CACHE_HEADERS });
  } catch (error) {
    console.error('Live match error:', error);
    return NextResponse.json(
      { error: 'This match is unavailable, please retry shortly' },
      { status: 503, headers: { ...NO_STORE, 'Retry-After': '3' } }
    );
  }
}
