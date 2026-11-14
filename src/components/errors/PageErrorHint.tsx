'use client';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { classifyPageError } from '@/lib/network-errors';

/**
 * One extra line for a page's own error screen when the cause is something the visitor can fix:
 * no internet, or an old copy of the site after a deploy. Renders nothing otherwise.
 */
export default function PageErrorHint({ error }: { error: unknown }) {
    const kind = classifyPageError(error, useOnlineStatus());
    if (kind === 'generic') return null;

    return (
        <p role="alert" className="mb-6 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-200">
            {kind === 'offline' ? (
                "You're offline. Check your Wi-Fi or mobile data, then try again."
            ) : (
                <>
                    The site was just updated.{' '}
                    <button type="button" onClick={() => window.location.reload()} className="font-semibold underline">
                        Reload the page
                    </button>{' '}
                    to get the latest version.
                </>
            )}
        </p>
    );
}
