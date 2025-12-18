'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type DatabaseStats = {
  overview: {
    totalUsers: number;
    totalQuizzes: number;
    totalQuestions: number;
    totalAttempts: number;
    totalPayments: number;
    totalWinnings: number;
    averageScore: number;
    completionRate: number;
  };
  recentActivity: {
    newUsers: number;
    newAttempts: number;
    newPayments: number;
    newWinnings: number;
  };
  topQuizzes: Array<{
    id: string;
    title: string;
    attemptCount: number;
  }>;
  prizeDistribution: Array<{
    prizeId: string;
    prizeName: string;
    prizeType: string;
    count: number;
  }>;
};

export default function DatabaseStatsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }

    if (status === 'authenticated' && session) {
      fetchStats();
    }
  }, [status, session, router]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/db-stats');
      
      if (response.status === 403) {
        setError('Access denied. Admin privileges required.');
        return;
      }
      
      if (!response.ok) {
        throw new Error('Failed to fetch database statistics');
      }
      
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-400 mx-auto"></div>
          <p className="mt-4 text-gray-200">Loading database statistics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="text-center">
          <div className="glass-card glass-border-red bg-red-500 bg-opacity-20 text-red-300 px-4 py-3 rounded">
            <p className="font-bold">Error</p>
            <p>{error}</p>
          </div>
          <Link 
            href="/admin/dashboard"
            className="mt-4 inline-block glass-card-blue glass-border-blue glass-hover-blue glass-transition text-white px-4 py-2 rounded"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-200">No statistics available</p>
          <Link 
            href="/admin/dashboard"
            className="mt-4 inline-block glass-card-blue glass-border-blue glass-hover-blue glass-transition text-white px-4 py-2 rounded"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-glass-dark">
      {/* Header */}
      <div className="glass-card glass-transition glass-hover shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center py-4 sm:py-6 space-y-4 sm:space-y-0">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-white">Database Statistics</h1>
              <p className="text-gray-200 text-sm sm:text-base">Comprehensive database insights and metrics</p>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-4 w-full sm:w-auto">
              {session?.user?.email && (
                <span className="text-xs sm:text-sm text-gray-300 truncate max-w-50">
                  Logged in as: {session.user.email}
                </span>
              )}
              <Link 
                href="/admin/dashboard"
                className="text-blue-300 hover:text-blue-200 font-medium glass-transition text-sm sm:text-base"
              >
                ← Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Overview Stats */}
          <div className="glass-card glass-transition glass-hover rounded-lg">
            <div className="px-6 py-4 border-b border-blue-400">
              <h2 className="text-xl font-semibold text-white">Overview</h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="glass-card-blue glass-border-blue p-4 rounded-lg">
                  <div className="flex items-center">
                    <div className="shrink-0">
                      <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">U</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-300">Total Users</p>
                      <p className="text-2xl font-semibold text-white">{stats.overview.totalUsers}</p>
                    </div>
                  </div>
                </div>

                <div className="glass-card-blue glass-border-blue p-4 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">Q</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-300">Total Quizzes</p>
                      <p className="text-2xl font-semibold text-white">{stats.overview.totalQuizzes}</p>
                    </div>
                  </div>
                </div>

                <div className="glass-card-blue glass-border-blue p-4 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-purple-500 rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">A</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-300">Total Attempts</p>
                      <p className="text-2xl font-semibold text-white">{stats.overview.totalAttempts}</p>
                    </div>
                  </div>
                </div>

                <div className="glass-card-blue glass-border-blue p-4 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">$</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-300">Total Payments</p>
                      <p className="text-2xl font-semibold text-white">{stats.overview.totalPayments}</p>
                    </div>
                  </div>
                </div>

                <div className="glass-card-blue glass-border-blue p-4 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-red-500 rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">?</span>
                      </div>
                    </div>
                    <div className="ml-3 sm:ml-4 min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-medium text-gray-300 truncate">Total Questions</p>
                      <p className="text-lg sm:text-2xl font-semibold text-white">{stats.overview.totalQuestions}</p>
                    </div>
                  </div>
                </div>

                <div className="glass-card-blue glass-border-blue p-4 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-indigo-500 rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">W</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-300">Total Winnings</p>
                      <p className="text-2xl font-semibold text-white">{stats.overview.totalWinnings}</p>
                    </div>
                  </div>
                </div>

                <div className="glass-card-blue glass-border-blue p-4 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-teal-500 rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">%</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-300">Avg Score</p>
                      <p className="text-2xl font-semibold text-white">{Math.round(stats.overview.averageScore * 100) / 100}%</p>
                    </div>
                  </div>
                </div>

                <div className="glass-card-blue glass-border-blue p-4 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-pink-500 rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">C</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-300">Completion Rate</p>
                      <p className="text-2xl font-semibold text-white">{stats.overview.completionRate}%</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="glass-card glass-transition glass-hover rounded-lg">
            <div className="px-6 py-4 border-b border-blue-400">
              <h2 className="text-xl font-semibold text-white">Recent Activity (Last 7 Days)</h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-300">{stats.recentActivity.newUsers}</p>
                  <p className="text-sm text-gray-300">New Users</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-green-300">{stats.recentActivity.newAttempts}</p>
                  <p className="text-sm text-gray-300">New Attempts</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-yellow-300">{stats.recentActivity.newPayments}</p>
                  <p className="text-sm text-gray-300">New Payments</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-purple-300">{stats.recentActivity.newWinnings}</p>
                  <p className="text-sm text-gray-300">New Winnings</p>
                </div>
              </div>
            </div>
          </div>

          {/* Top Quizzes */}
          <div className="glass-card glass-transition glass-hover rounded-lg">
            <div className="px-6 py-4 border-b border-blue-400">
              <h2 className="text-xl font-semibold text-white">Top Performing Quizzes</h2>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {stats.topQuizzes.map((quiz, index) => (
                  <div key={quiz.id} className="flex items-center justify-between p-4 glass-card-blue glass-border-blue rounded-lg">
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold mr-4">
                        {index + 1}
                      </div>
                      <div>
                        <h3 className="font-medium text-white">{quiz.title}</h3>
                        <p className="text-sm text-gray-300">Quiz ID: {quiz.id}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-green-300">{quiz.attemptCount}</p>
                      <p className="text-sm text-gray-300">Attempts</p>
                    </div>
                  </div>
                ))}
                {stats.topQuizzes.length === 0 && (
                  <p className="text-gray-300 text-center py-8">No quiz data available</p>
                )}
              </div>
            </div>
          </div>

          {/* Prize Distribution */}
          <div className="glass-card glass-transition glass-hover rounded-lg">
            <div className="px-6 py-4 border-b border-blue-400">
              <h2 className="text-xl font-semibold text-white">Prize Distribution</h2>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {stats.prizeDistribution.map((prize) => (
                  <div key={prize.prizeId} className="flex items-center justify-between p-4 glass-card-blue glass-border-blue rounded-lg">
                    <div>
                      <h3 className="font-medium text-white">{prize.prizeName}</h3>
                      <p className="text-sm text-gray-300">Type: {prize.prizeType}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-purple-300">{prize.count}</p>
                      <p className="text-sm text-gray-300">Won</p>
                    </div>
                  </div>
                ))}
                {stats.prizeDistribution.length === 0 && (
                  <p className="text-gray-300 text-center py-8">No prize data available</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}