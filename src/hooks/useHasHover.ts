'use client';

/**
 * Returns whether the primary input device supports hover (i.e. is not a
 * touch-only device).
 *
 * The result is computed once per page load and cached at module level —
 * subsequent calls from any component are zero-cost and never trigger a
 * re-render.
 */

let _cached: boolean | null = null;

export function useHasHover(): boolean {
  if (_cached === null) {
    if (typeof window === 'undefined') return false; // SSR guard
    _cached = window.matchMedia('(hover: hover)').matches;
  }
  return _cached;
}
