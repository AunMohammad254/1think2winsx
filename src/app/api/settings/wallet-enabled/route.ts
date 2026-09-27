import { NextResponse } from 'next/server';
import { isWalletEnabled } from '@/lib/wallet/service';

/**
 * GET /api/settings/wallet-enabled
 *
 * Returns the wallet feature flag status.
 * Used by client components (quizzes page, navbar) to conditionally
 * show/hide wallet UI without exposing admin settings.
 *
 * Response shape: { walletEnabled: boolean }
 * Cached for 60 seconds — matches the in-memory flag cache TTL.
 */
export async function GET() {
    const enabled = await isWalletEnabled();
    return NextResponse.json(
        { walletEnabled: enabled },
        {
            headers: {
                // Cache for 60s — safe since the flag rarely changes and the cache
                // is invalidated server-side on admin toggle anyway.
                'Cache-Control': 'public, max-age=60, s-maxage=60',
            },
        }
    );
}
