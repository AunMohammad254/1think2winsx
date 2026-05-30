'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { LeaderboardEntry } from '../app/leaderboard/types';

type LeaderboardResponse = {
  leaderboard: LeaderboardEntry[];
  total: number;
  timeframe: string;
  lastUpdated: string;
};

export function useLeaderboard(timeframe: 'weekly' | 'monthly' | 'allTime') {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [playCounter, setPlayCounter] = useState(false);
  const prevDataRef = useRef<Map<string, { rank: number; score: number }>>(new Map());
  const dataLoadedRef = useRef(false);

  const fetchLeaderboard = useCallback(async (skipCounter = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/leaderboard?timeframe=${timeframe}&limit=50`);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
      const data: LeaderboardResponse = await response.json();
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

  useEffect(() => {
    prevDataRef.current = new Map();
    dataLoadedRef.current = false;
    fetchLeaderboard(true);
  }, [fetchLeaderboard]);

  useEffect(() => {
    if (playCounter) {
      const timer = setTimeout(() => setPlayCounter(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [playCounter]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const startPolling = () => {
      interval = setInterval(() => fetchLeaderboard(false), 300000);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        fetchLeaderboard(false);
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    startPolling();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, [fetchLeaderboard]);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    fetchLeaderboard(true);
  }, [fetchLeaderboard]);

  return {
    leaderboard,
    loading,
    error,
    lastUpdated,
    playCounter,
    prevData: prevDataRef.current,
    dataLoaded: dataLoadedRef.current,
    handleRetry
  };
}
