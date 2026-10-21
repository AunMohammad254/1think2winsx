'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { LiveSnapshot } from '@/lib/live-catalog';
import { useJitteredPolling } from '@/hooks/useJitteredPolling';

/**
 * The public quiz snapshot for the landing page, shared by every section that shows it.
 *
 * It only ever requests GET /api/live: the URL Cloudflare caches for 5 s (Cache Rule), with no query
 * string (the WAF blocks one on /api/live*) and no cookies, so however many visitors are on the page,
 * the origin sees about one request per Cloudflare location per 5 s. The sections mount together
 * and share one request; after that a slow refresh keeps an open tab current.
 */

export interface LiveSnapshotState {
  /** loading: no answer yet. error: the first request failed (sections keep their static copy). */
  status: 'loading' | 'ready' | 'error';
  snapshot: LiveSnapshot | null;
}

const INITIAL: LiveSnapshotState = { status: 'loading', snapshot: null };
// An open landing tab refreshes about once a minute; quizzes are scheduled hours ahead
const REFRESH_MS = 60_000;
const REFRESH_JITTER_MS = 15_000;
// Another section asking within this window reuses the answer instead of requesting again
const FRESH_MS = 30_000;

let state: LiveSnapshotState = INITIAL;
let fetchedAt = 0;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function setState(next: LiveSnapshotState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const getState = () => state;
const getServerState = () => INITIAL;

/**
 * Fetch the snapshot unless one younger than `maxAgeMs` is already held. Resolves false on failure,
 * so the poller backs off; a failure keeps the last good snapshot on screen.
 */
export function loadLiveSnapshot(maxAgeMs = 0): Promise<boolean> {
  if (inflight) return inflight;
  if (state.snapshot && Date.now() - fetchedAt < maxAgeMs) return Promise.resolve(true);
  inflight = (async () => {
    try {
      const response = await fetch('/api/live', { credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body?.quizzes)) throw new Error('Unexpected snapshot');
      fetchedAt = Date.now();
      setState({ status: 'ready', snapshot: body as LiveSnapshot });
      return true;
    } catch {
      if (state.status === 'loading') setState({ status: 'error', snapshot: null });
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Forget the snapshot (tests start each case from scratch). */
export function resetLiveSnapshot() {
  state = INITIAL;
  fetchedAt = 0;
  inflight = null;
}

export function useLiveSnapshot(): LiveSnapshotState {
  const current = useSyncExternalStore(subscribe, getState, getServerState);
  const refresh = useCallback(() => loadLiveSnapshot(FRESH_MS), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useJitteredPolling(refresh, { intervalMs: REFRESH_MS, jitterMs: REFRESH_JITTER_MS });
  return current;
}
