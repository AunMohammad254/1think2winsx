'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { LeaderboardEntry } from '../app/leaderboard/types';

type LeaderboardResponse = {
  leaderboard: LeaderboardEntry[];
  total: number;
  timeframe: string;
  lastUpdated: string;
};

// ─── Module-level cache (survives re-renders, cleared on hard refresh) ────────
// Keyed by timeframe. Entry is invalidated after 60 s so fresh data is always
// shown within a minute without hitting the database on every tab switch.
const CACHE_TTL_MS = 60_000;
type CacheEntry = { data: LeaderboardResponse; ts: number };
const leaderboardCache = new Map<string, CacheEntry>();

export function useLeaderboard(timeframe: 'weekly' | 'monthly' | 'allTime') {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [playCounter, setPlayCounter] = useState(false);

  const prevDataRef = useRef<Map<string, { rank: number; score: number }>>(new Map());
  const dataLoadedRef = useRef(false);

  // ── Stable ref so the polling interval never needs to re-mount ───────────
  // We update fetchRef on every render so the closure always sees the latest
  // timeframe without adding it as a dep to the interval effect.
  const fetchLeaderboard = useCallback(async (skipCounter = false, bustCache = false) => {
    // Check module-level cache first (unless caller explicitly wants fresh data)
    if (!bustCache) {
      const cached = leaderboardCache.get(timeframe);
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        setLeaderboard((prev) => {
          const prevMap = new Map(prev.map((e) => [e.userName, { rank: e.rank, score: e.totalScore }]));
          prevDataRef.current = prevMap;
          return cached.data.leaderboard;
        });
        setLastUpdated(cached.data.lastUpdated);
        if (dataLoadedRef.current && !skipCounter) setPlayCounter(true);
        dataLoadedRef.current = true;
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/leaderboard?timeframe=${timeframe}&limit=50`);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
      const data: LeaderboardResponse = await response.json();

      // Populate cache
      leaderboardCache.set(timeframe, { data, ts: Date.now() });

      setLeaderboard((prev) => {
        const prevMap = new Map(prev.map((e) => [e.userName, { rank: e.rank, score: e.totalScore }]));
        prevDataRef.current = prevMap;
        return data.leaderboard;
      });
      setLastUpdated(data.lastUpdated);
      if (dataLoadedRef.current && !skipCounter) setPlayCounter(true);
      dataLoadedRef.current = true;
    } catch {
      setError('Failed to load leaderboard data. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  // ── Ref that always points to the latest fetch function ─────────────────
  // Used by the stable polling interval below so it doesn't need to re-mount.
  const fetchRef = useRef(fetchLeaderboard);
  useEffect(() => { fetchRef.current = fetchLeaderboard; }, [fetchLeaderboard]);

  // ── Fetch fresh data when timeframe changes ──────────────────────────────
  useEffect(() => {
    prevDataRef.current = new Map();
    dataLoadedRef.current = false;
    fetchLeaderboard(true);
  }, [fetchLeaderboard]);

  // ── Reset playCounter after animation ───────────────────────────────────
  useEffect(() => {
    if (playCounter) {
      const timer = setTimeout(() => setPlayCounter(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [playCounter]);

  // ── Stable polling interval — never re-mounts ────────────────────────────
  // Uses fetchRef so it always calls the latest version without being a dep.
  useEffect(() => {
    let interval: NodeJS.Timeout;

    const startPolling = () => {
      interval = setInterval(() => fetchRef.current(false, true), 300_000);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        fetchRef.current(false, true);
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    startPolling();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, []); // ← empty deps: mounts once for the lifetime of the component

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    leaderboardCache.delete(timeframe); // Bust cache on manual retry
    fetchLeaderboard(true, true);
  }, [fetchLeaderboard, timeframe]);

  return {
    leaderboard,
    loading,
    error,
    lastUpdated,
    playCounter,
    prevData: prevDataRef.current,
    dataLoaded: dataLoadedRef.current,
    handleRetry,
  };
}
