'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

type LeaderboardEntry = {
  id: string;
  rank: number;
  userName: string;
  quizzesTaken: number;
  correctAnswers: number;
  totalScore: number;
  winCount: number;
  averageScore?: number;
};

type LeaderboardResponse = {
  leaderboard: LeaderboardEntry[];
  total: number;
  timeframe: string;
  lastUpdated: string;
};

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<'weekly' | 'monthly' | 'allTime'>('weekly');
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Fetch leaderboard data from API
  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/leaderboard?timeframe=${timeframe}&limit=50`);

        if (!response.ok) {
          throw new Error(`Failed to fetch leaderboard: ${response.statusText}`);
        }

        const data: LeaderboardResponse = await response.json();
        setLeaderboard(data.leaderboard);
        setLastUpdated(data.lastUpdated);
      } catch (err) {
        console.error('Error fetching leaderboard:', err);
        setError('Failed to load leaderboard data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, [timeframe]);

  // Auto-refresh leaderboard every 30 seconds for real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (!loading) {
        fetchLeaderboard();
      }
    }, 30000); // 30 seconds

    const fetchLeaderboard = async () => {
      try {
        const response = await fetch(`/api/leaderboard?timeframe=${timeframe}&limit=50`);
        if (response.ok) {
          const data: LeaderboardResponse = await response.json();
          setLeaderboard(data.leaderboard);
          setLastUpdated(data.lastUpdated);
        }
      } catch (err) {
        console.error('Error auto-refreshing leaderboard:', err);
      }
    };

    return () => clearInterval(interval);
  }, [timeframe, loading]);

  // Find current user in leaderboard
  const userName = user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0];
  const currentUserEntry = userName
    ? leaderboard.find(entry => entry.userName === userName)
    : null;


  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1: return '👑';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return '🏆';
    }
  };

  const getRankGradient = (rank: number) => {
    switch (rank) {
      case 1: return 'from-yellow-400 via-yellow-500 to-yellow-600';
      case 2: return 'from-gray-300 via-gray-400 to-gray-500';
      case 3: return 'from-amber-400 via-amber-500 to-amber-600';
      default: return 'from-blue-400 via-blue-500 to-blue-600';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white relative overflow-hidden">
      {/* Animated Background Elements */}
      {!isMobile && (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-900/20 via-slate-900/10 to-transparent"></div>
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-r from-purple-500/5 to-blue-500/5 rounded-full blur-3xl animate-spin" style={{ animationDuration: '20s' }}></div>
        </>
      )}

      <div className="relative z-10 container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl p-8 shadow-2xl`}>
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent mb-4">
              🏆 Leaderboard
            </h1>
            <p className="text-gray-300 text-lg mb-4">
              Compete with the best quiz masters worldwide
            </p>
            {lastUpdated && (
              <p className="text-gray-400 text-sm">
                Last updated: {lastUpdated.toLocaleString()}
              </p>
            )}
          </div>
        </div>

        {/* Timeframe Selector */}
        <div className="flex justify-center mb-8 sm:mb-12">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-2 shadow-xl">
            <div className="flex space-x-1" role="group">
              {[
                { key: 'weekly', label: 'Weekly', icon: '📅' },
                { key: 'monthly', label: 'Monthly', icon: '🗓️' },
                { key: 'allTime', label: 'All Time', icon: '⏰' }
              ].map(({ key, label, icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`relative px-4 sm:px-6 py-2 sm:py-3 text-sm sm:text-base font-medium rounded-xl transition-all duration-300 touch-manipulation ${timeframe === key
                    ? `bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg ${!isMobile ? 'transform scale-105' : ''}`
                    : `text-gray-300 ${!isMobile ? 'hover:text-white hover:bg-white/10' : ''}`
                    }`}
                  onClick={() => setTimeframe(key as 'weekly' | 'monthly' | 'allTime')}
                >
                  <span className="mr-2">{icon}</span>
                  {label}
                  {timeframe === key && !isMobile && (
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-600/20 rounded-xl blur animate-pulse"></div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl p-8 shadow-2xl`}>
              <div className="flex flex-col items-center space-y-4">
                <div className="relative">
                  <div className={`w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full ${!isMobile ? 'animate-spin' : ''}`}></div>
                  <div className={`absolute inset-0 w-16 h-16 border-4 border-purple-500/30 border-b-purple-500 rounded-full ${!isMobile ? 'animate-spin' : ''}`} style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
                </div>
                <p className="text-gray-300 text-lg">Loading leaderboard...</p>
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="flex justify-center">
            <div className={`${!isMobile ? 'backdrop-blur-xl' : ''} bg-red-500/10 border border-red-500/30 rounded-3xl p-8 shadow-2xl max-w-md`}>
              <div className="text-center">
                <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">⚠️</span>
                </div>
                <p className="text-red-300 mb-6">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className={`px-6 py-3 bg-gradient-to-r from-red-500 to-pink-600 text-white rounded-xl ${!isMobile ? 'hover:from-red-600 hover:to-pink-700 transform hover:scale-105' : ''} transition-all duration-300 shadow-lg touch-manipulation`}
                >
                  🔄 Retry
                </button>
              </div>
            </div>
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="flex justify-center">
            <div className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl p-8 shadow-2xl max-w-md`}>
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">📊</span>
                </div>
                <p className="text-gray-300 mb-6">
                  No leaderboard data available for the selected timeframe.
                </p>
                <Link
                  href="/quizzes"
                  className={`inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl ${!isMobile ? 'hover:from-blue-600 hover:to-purple-700 transform hover:scale-105' : ''} transition-all duration-300 shadow-lg touch-manipulation`}
                >
                  🎯 Take a Quiz
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Top 3 Podium */}
            {leaderboard.length >= 3 && (
              <div className="mb-12">
                <div className="flex justify-center items-end space-x-4 mb-8">
                  {/* Second Place */}
                  <div className={`${!isMobile ? 'backdrop-blur-xl' : ''} bg-gradient-to-b from-gray-400/20 to-gray-600/20 border border-gray-400/30 rounded-3xl p-6 shadow-2xl ${!isMobile ? 'transform hover:scale-105 transition-all duration-300' : ''}`}>
                    <div className="text-center">
                      <div className="w-20 h-20 bg-gradient-to-r from-gray-300 to-gray-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <span className="text-3xl">🥈</span>
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">{leaderboard[1]?.userName}</h3>
                      <p className="text-gray-300 text-sm mb-2">Score: {leaderboard[1]?.totalScore}</p>
                      <div className="bg-gray-400/20 rounded-full px-3 py-1">
                        <span className="text-gray-300 text-xs">2nd Place</span>
                      </div>
                    </div>
                  </div>

                  {/* First Place */}
                  <div className={`${!isMobile ? 'backdrop-blur-xl' : ''} bg-gradient-to-b from-yellow-400/20 to-yellow-600/20 border border-yellow-400/30 rounded-3xl p-8 shadow-2xl ${!isMobile ? 'transform hover:scale-105 transition-all duration-300' : ''} -mt-8`}>
                    <div className="text-center">
                      <div className={`w-24 h-24 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg ${!isMobile ? 'animate-pulse' : ''}`}>
                        <span className="text-4xl">👑</span>
                      </div>
                      <h3 className="text-2xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-2">
                        {leaderboard[0]?.userName}
                      </h3>
                      <p className="text-gray-300 mb-2">Score: {leaderboard[0]?.totalScore}</p>
                      <div className="bg-yellow-400/20 rounded-full px-4 py-2">
                        <span className="text-yellow-300 font-bold">🏆 Champion</span>
                      </div>
                    </div>
                  </div>

                  {/* Third Place */}
                  <div className={`${!isMobile ? 'backdrop-blur-xl' : ''} bg-gradient-to-b from-amber-400/20 to-amber-600/20 border border-amber-400/30 rounded-3xl p-6 shadow-2xl ${!isMobile ? 'transform hover:scale-105 transition-all duration-300' : ''}`}>
                    <div className="text-center">
                      <div className="w-20 h-20 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <span className="text-3xl">🥉</span>
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">{leaderboard[2]?.userName}</h3>
                      <p className="text-gray-300 text-sm mb-2">Score: {leaderboard[2]?.totalScore}</p>
                      <div className="bg-amber-400/20 rounded-full px-3 py-1">
                        <span className="text-amber-300 text-xs">3rd Place</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Leaderboard Table */}
            <div className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl shadow-2xl overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-blue-500/20 to-purple-600/20 border-b border-white/10">
                      <th className="px-4 sm:px-6 py-4 text-left text-sm font-bold text-white uppercase tracking-wider">
                        🏅 Rank
                      </th>
                      <th className="px-4 sm:px-6 py-4 text-left text-sm font-bold text-white uppercase tracking-wider">
                        👤 Player
                      </th>
                      <th className="px-4 sm:px-6 py-4 text-left text-sm font-bold text-white uppercase tracking-wider">
                        📝 Quizzes
                      </th>
                      <th className="px-4 sm:px-6 py-4 text-left text-sm font-bold text-white uppercase tracking-wider">
                        ✅ Correct
                      </th>
                      <th className="px-4 sm:px-6 py-4 text-left text-sm font-bold text-white uppercase tracking-wider">
                        🎯 Score
                      </th>
                      <th className="px-4 sm:px-6 py-4 text-left text-sm font-bold text-white uppercase tracking-wider">
                        🏆 Wins
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {leaderboard.map((entry, _index) => (
                      <tr
                        key={entry.id}
                        className={`group ${!isMobile ? 'hover:bg-white/10' : ''} transition-all duration-300 touch-manipulation ${entry.userName === userName
                          ? 'bg-gradient-to-r from-blue-500/20 to-purple-600/20 border-l-4 border-blue-400'
                          : ''
                          }`}
                      >
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            {entry.rank <= 3 ? (
                              <div className={`flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-r ${getRankGradient(entry.rank)} shadow-lg ${!isMobile ? 'transform group-hover:scale-110 transition-all duration-300' : ''}`}>
                                <span className="text-white font-bold text-lg">{entry.rank}</span>
                              </div>
                            ) : (
                              <div className={`flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-r from-slate-600 to-slate-700 border border-white/20 shadow-lg ${!isMobile ? 'transform group-hover:scale-110 transition-all duration-300' : ''}`}>
                                <span className="text-white font-bold">{entry.rank}</span>
                              </div>
                            )}
                            <span className="ml-3 text-2xl">{getRankIcon(entry.rank)}</span>
                          </div>
                        </td>
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-purple-600 rounded-full flex items-center justify-center mr-3 shadow-lg">
                              <span className="text-white font-bold text-sm">
                                {entry.userName.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <div className={`text-sm font-bold text-white ${!isMobile ? 'group-hover:text-blue-300 transition-colors duration-300' : ''}`}>
                                {entry.userName}
                              </div>
                              {entry.userName === userName && (
                                <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-500/30 text-blue-300 border border-blue-500/50 mt-1">
                                  ⭐ You
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="bg-blue-500/20 rounded-lg px-3 py-1 border border-blue-500/30">
                              <span className="text-blue-300 font-medium">{entry.quizzesTaken}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="bg-green-500/20 rounded-lg px-3 py-1 border border-green-500/30">
                              <span className="text-green-300 font-medium">{entry.correctAnswers}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-lg px-4 py-2 border border-purple-500/30">
                              <span className="text-white font-bold text-lg">{entry.totalScore}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            {entry.winCount > 0 ? (
                              <div className="bg-yellow-500/20 rounded-lg px-3 py-1 border border-yellow-500/30 flex items-center">
                                <span className="text-yellow-300 font-bold mr-1">{entry.winCount}</span>
                                <span className="text-yellow-400">🏆</span>
                              </div>
                            ) : (
                              <div className="bg-gray-500/20 rounded-lg px-3 py-1 border border-gray-500/30">
                                <span className="text-gray-400">0</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* User's Position if not in visible leaderboard */}
            {user && !currentUserEntry && (
              <div className="mt-8">
                <div className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl p-6 shadow-2xl`}>
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-gradient-to-r from-blue-400 to-purple-600 rounded-full flex items-center justify-center mr-4">
                      <span className="text-2xl">📍</span>
                    </div>
                    <h3 className="text-xl font-bold text-white">Your Position</h3>
                  </div>
                  <p className="text-gray-300 mb-4">
                    You haven&apos;t participated in any quizzes yet or don&apos;t appear in the top rankings for this timeframe.
                  </p>
                  <Link
                    href="/quizzes"
                    className={`inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl ${!isMobile ? 'hover:from-blue-600 hover:to-purple-700 transform hover:scale-105' : ''} transition-all duration-300 shadow-lg touch-manipulation`}
                  >
                    🚀 Start playing now
                  </Link>
                </div>
              </div>
            )}

            {/* Call to Action */}
            <div className="mt-12 text-center">
              <div className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl p-8 shadow-2xl`}>
                <div className="flex items-center justify-center mb-6">
                  <div className={`w-16 h-16 bg-gradient-to-r from-green-400 to-blue-500 rounded-full flex items-center justify-center shadow-lg ${!isMobile ? 'animate-bounce' : ''}`}>
                    <span className="text-3xl">🎯</span>
                  </div>
                </div>
                <h3 className="text-2xl font-bold bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent mb-4">
                  Want to climb the leaderboard?
                </h3>
                <p className="text-gray-300 mb-6">
                  Challenge yourself with our exciting quizzes and compete with players worldwide!
                </p>
                <Link
                  href="/quizzes"
                  className={`inline-flex items-center px-8 py-4 bg-gradient-to-r from-green-500 to-blue-600 text-white text-lg font-bold rounded-2xl ${!isMobile ? 'hover:from-green-600 hover:to-blue-700 transform hover:scale-105' : ''} transition-all duration-300 shadow-2xl touch-manipulation`}
                >
                  <span className="mr-3">🎮</span>
                  Play Quizzes Now
                  <span className="ml-3">🚀</span>
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}