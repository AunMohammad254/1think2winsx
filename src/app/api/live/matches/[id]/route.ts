/* v8 ignore next -- an import line has no logic; Vitest's rewrite of it reports a phantom branch */
import { NextResponse } from 'next/server';
import { getPublicMatch } from '@/lib/match-feed';
import { createSecureJsonResponse } from '@/lib/security-headers';

// Like /api/live: browsers always ask again, Cloudflare keeps the answer 3 s (needs the Cache Rule for
// /api/live/matches/). A ball changes what players see, so the copy stays short-lived.
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=0, s-maxage=3, stale-while-revalidate=3' };
// Not live (yet, or any more): kept 10 s at the edge, so screens left open on it (they check every 30 s)
// and links shared before Go live cost Hostinger a request per location every 10 s, not one per viewer.
// A match taken live shows up that much later.
const NOT_LIVE_HEADERS = { 'Cache-Control': 'public, max-age=0, s-maxage=10' };
// Failures are never cached
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/live/matches/[id] - a live match as players see it (src/lib/match-feed.ts): the score and the
 * questions sent so far. No sign-in and nothing per player, so one cached copy serves everyone watching;
 * the quiz page polls it every few seconds and pops each over up on the stream. Answering goes through the
 * signed-in submit route.
 *
 * `serverNow` is the time of this response: a copy Cloudflare kept is older by its Age header.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const match = await getPublicMatch(id);
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404, headers: NOT_LIVE_HEADERS });
    return createSecureJsonResponse({ ...match, serverNow: new Date().toISOString() }, { status: 200, headers: CACHE_HEADERS });
  } catch (error) {
    console.error('Live match error:', error);
    return NextResponse.json(
      { error: 'This match is unavailable, please retry shortly' },
      { status: 503, headers: { ...NO_STORE, 'Retry-After': '3' } }
    );
  }
}
