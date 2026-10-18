/* v8 ignore next -- an import line has no logic; Vitest's rewrite of it reports a phantom branch */
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getActiveQuizCatalog } from '@/lib/quiz-catalog';
import { toLiveQuiz } from '@/lib/live-catalog';
import { isWalletEnabled } from '@/lib/wallet/service';
import { createSecureJsonResponse } from '@/lib/security-headers';

// Browsers always ask again (max-age=0); Cloudflare keeps the answer 5 s (s-maxage), which needs a
// Cache Rule for /api/live because Cloudflare does not cache JSON by default.
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=5' };

/**
 * GET /api/live - the public part of the quiz list, for cached polling (see src/lib/live-catalog.ts).
 *
 * No sign-in and nothing per player, so one cached answer serves everyone. It reads the same 15 s
 * process cache as /api/quizzes (which also activates scheduled quizzes that are due), so even a
 * cache miss costs no database query most of the time.
 *
 * The landing page reads it too (cards and countdown), so it carries the wallet flag: with the wallet
 * off every quiz is free. The flag comes from its own process cache, like the catalogue.
 */
export async function GET() {
  try {
    const [catalog, walletEnabled] = await Promise.all([getActiveQuizCatalog(), isWalletEnabled()]);
    const quizzes = catalog.map(toLiveQuiz);
    // Players compare versions and only touch their list when something changed
    const version = createHash('sha1').update(JSON.stringify({ walletEnabled, quizzes })).digest('base64url');
    return createSecureJsonResponse({ version, quizzes, walletEnabled }, { status: 200, headers: CACHE_HEADERS });
  } catch (error) {
    console.error('Live quiz snapshot error:', error);
    // Not cached, and the poller backs off on failure
    return NextResponse.json(
      { error: 'Live quizzes are unavailable, please retry shortly' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } }
    );
  }
}
