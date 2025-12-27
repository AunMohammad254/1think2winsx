'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useProfile } from '@/contexts/ProfileContext';
import ProfilePictureUpload from '@/components/ProfilePictureUpload';
import PrizeRedemption from '@/components/PrizeRedemption';
import { ProfileHeader, ProfileAvatar, BalanceCard, QuickActions, StatsGrid } from '@/components/profile';

export default function ProfilePage() {
  const { user, isLoading } = useAuth();
  const { profile, loading: profileLoading, error: profileError, refreshProfile } = useProfile();
  const router = useRouter();
  const [uploadLoading, setUploadLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const handleImageUpload = async (file: File) => {
    setUploadLoading(true);
    try {
      const formData = new FormData();
      formData.append('profilePicture', file);

      const response = await fetch('/api/profile/upload-picture', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Upload failed');
      }

      await refreshProfile();
      setShowUploadModal(false);

    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    } finally {
      setUploadLoading(false);
    }
  };

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.push('/login');
      return;
    }
  }, [user, isLoading, router]);

  // Stats for the grid
  const stats = [
    {
      id: 'points',
      label: 'Total Points',
      value: profile?.points || 0,
      icon: (
        <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
        </svg>
      ),
      gradient: 'bg-gradient-to-br from-yellow-500/20 to-orange-500/20',
    },
    {
      id: 'quizzes',
      label: 'Quizzes Taken',
      value: profile?.quizzesTaken || 0,
      icon: (
        <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: 'correct',
      label: 'Correct Answers',
      value: profile?.correctAnswers || 0,
      icon: (
        <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    {
      id: 'wins',
      label: 'Total Wins',
      value: profile?.winCount || 0,
      icon: (
        <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
        </svg>
      ),
      gradient: 'bg-gradient-to-br from-purple-500/20 to-pink-500/20',
    },
  ];

  // Loading state
  if (isLoading || profileLoading) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
          <div className="absolute top-0 left-0 w-full h-full">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-6 relative">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full animate-spin"></div>
              <div className="absolute inset-2 bg-slate-900 rounded-full flex items-center justify-center">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full"></div>
              </div>
            </div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
              Loading Profile
            </h2>
            <p className="text-slate-400">Preparing your dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (profileError) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900"></div>
        <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] p-8 text-center max-w-md w-full">
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-red-400 to-pink-400 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Profile Error</h2>
            <p className="text-slate-300 mb-6">{profileError}</p>
            <button
              onClick={() => refreshProfile()}
              className="w-full px-6 py-3 bg-gradient-to-r from-red-500 to-pink-500 text-white font-semibold rounded-2xl hover:from-red-600 hover:to-pink-600 transform hover:scale-105 transition-all duration-200"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No profile state
  if (!profile) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900"></div>
        <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] p-8 text-center max-w-md w-full">
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">No Profile Data</h2>
            <p className="text-slate-300 mb-6">Unable to load your profile information</p>
            <button
              onClick={() => refreshProfile()}
              className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold rounded-2xl hover:from-blue-600 hover:to-purple-600 transform hover:scale-105 transition-all duration-200"
            >
              Refresh Profile
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <div className="absolute top-0 left-0 w-full h-full">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
          <div className="absolute top-3/4 left-1/2 w-64 h-64 bg-pink-500/10 rounded-full blur-3xl animate-pulse delay-2000"></div>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 py-6 lg:py-8">
        {/* Main content wrapper - narrow on mobile, wide on desktop */}
        <div className="max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto space-y-6 lg:space-y-8">

          {/* Header */}
          <ProfileHeader title="Profile" backHref="/" />

          {/* Avatar Section */}
          <div className="relative">
            <button
              onClick={() => setShowUploadModal(true)}
              className="block mx-auto lg:mx-0 relative group"
            >
              <ProfileAvatar
                imageSrc={profile.profilePicture}
                name={profile.name}
                userId={profile.id.slice(0, 8)}
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="w-32 h-32 rounded-full bg-black/50 flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              </div>
            </button>
            <p className="text-center lg:text-left text-slate-400 text-xs mt-2">
              Member since {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short'
              }) : 'N/A'}
            </p>
          </div>

          {/* Balance Card */}
          <BalanceCard balance={profile.walletBalance || 0} />

          {/* Quick Actions */}
          <QuickActions />

          {/* Stats Grid */}
          <StatsGrid stats={stats} />

          {/* Prizes Section */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden">
            <div className="p-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white">Your Prizes</h2>
              </div>
            </div>

            <div className="p-5">
              {profile.prizes && profile.prizes.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4">
                  {profile.prizes.slice(0, 4).map((prize) => (
                    <div key={prize.id} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                      <div className="aspect-square bg-gradient-to-br from-purple-500/10 to-blue-500/10 flex items-center justify-center p-4">
                        <Image
                          src={prize.image}
                          alt={prize.name}
                          width={80}
                          height={80}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="p-3">
                        <h3 className="font-medium text-white text-sm truncate">{prize.name}</h3>
                        <div className="flex items-center gap-1 mt-1">
                          <div className={`w-2 h-2 rounded-full ${prize.status === 'pending' ? 'bg-yellow-400' :
                            prize.status === 'approved' ? 'bg-green-400' :
                              prize.status === 'fulfilled' ? 'bg-blue-400' :
                                prize.status === 'rejected' ? 'bg-red-400' :
                                  'bg-gray-400'
                            }`}></div>
                          <span className="text-xs text-slate-400 capitalize">{prize.status}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h3 className="text-white font-semibold mb-2">No Prizes Yet</h3>
                  <p className="text-slate-400 text-sm mb-4">Play quizzes to win rewards!</p>
                  <Link
                    href="/quizzes"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white text-sm font-semibold rounded-xl hover:from-purple-600 hover:to-blue-600 transition-all duration-200"
                  >
                    Start Playing
                  </Link>
                </div>
              )}
              {profile.prizes && profile.prizes.length > 4 && (
                <Link
                  href="/prizes"
                  className="block mt-4 text-center text-sm text-blue-400 hover:text-blue-300"
                >
                  View all {profile.prizes.length} prizes →
                </Link>
              )}
            </div>
          </div>

          {/* Prize Redemption */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden">
            <PrizeRedemption />
          </div>

          {/* Quiz History */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden">
            <div className="p-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white">Quiz History</h2>
              </div>
            </div>

            <div className="p-5 lg:p-6">
              {profile.quizHistory && profile.quizHistory.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
                  {profile.quizHistory.slice(0, 5).map((attempt) => {
                    const hasWinnings = attempt.winnings && attempt.winnings.length > 0;
                    const scorePercent = Math.min(100, Math.max(0, (attempt.score / Math.max(1, attempt.quiz._count.questions)) * 100));

                    return (
                      <div key={attempt.id} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-medium text-white text-sm truncate flex-1 mr-2">{attempt.quiz.title}</h3>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${hasWinnings
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                            }`}>
                            {hasWinnings ? '🏆 Winner' : 'Played'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 text-xs">
                            {new Date(attempt.createdAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric'
                            })}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-white text-sm font-medium">
                              {attempt.score}/{attempt.quiz._count.questions}
                            </span>
                            <div className="w-16 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-gradient-to-r from-blue-400 to-purple-400 h-1.5 rounded-full"
                                style={{ width: `${scorePercent}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-white font-semibold mb-2">No Quiz History</h3>
                  <p className="text-slate-400 text-sm mb-4">Start your quiz journey today!</p>
                  <Link
                    href="/quizzes"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-sm font-semibold rounded-xl hover:from-blue-600 hover:to-purple-600 transition-all duration-200"
                  >
                    Browse Quizzes
                  </Link>
                </div>
              )}
              {profile.quizHistory && profile.quizHistory.length > 5 && (
                <Link
                  href="/quizzes"
                  className="block mt-4 text-center text-sm text-blue-400 hover:text-blue-300"
                >
                  View all history →
                </Link>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Profile Picture Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="backdrop-blur-xl bg-slate-900/95 border border-white/10 rounded-[32px] p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-white">Update Profile Picture</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="w-8 h-8 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ProfilePictureUpload
              currentImage={profile.profilePicture || undefined}
              onImageUpload={handleImageUpload}
              loading={uploadLoading}
            />
          </div>
        </div>
      )}
    </div>
  );
}