'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the wallet (paid day pass, deposits) is switched on, from /api/settings/wallet-enabled.
 * For public pages Cloudflare caches for a year (/how-to-play, /contact ...): their HTML can't carry
 * the flag, so they read it in the browser. null until it is known; a failed request also leaves it
 * null, so a page shows its wording for both cases rather than guessing.
 */
export function useWalletEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/settings/wallet-enabled', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { walletEnabled?: unknown } | null) => {
        if (typeof data?.walletEnabled === 'boolean') setEnabled(data.walletEnabled);
      })
      .catch(() => {
        // Aborted on unmount, or offline: stay unknown
      });
    return () => controller.abort();
  }, []);

  return enabled;
}
