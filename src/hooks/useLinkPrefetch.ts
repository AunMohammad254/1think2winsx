'use client';

import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { linkPrefetch } from '@/lib/link-prefetch';

/**
 * `linkPrefetch` for the navbar and footer, which are on every page. Signed-in visitors get no prefetch:
 * their session cookie sends every prefetch past the Cloudflare cache to Hostinger, about 11 requests per
 * desktop page view before this. While auth is still loading the visitor may be signed in, so links wait;
 * once it settles to signed out, the public pages prefetch as usual (Cloudflare caches those).
 */
export function useLinkPrefetch() {
  const { user, isLoading } = useAuth();
  const mayBeSignedIn = isLoading || user !== null;
  return useCallback((href: string) => linkPrefetch(href, mayBeSignedIn), [mayBeSignedIn]);
}
