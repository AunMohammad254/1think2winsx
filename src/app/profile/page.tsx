'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useProfile } from '@/contexts/ProfileContext';
import ProfilePictureUpload from '@/components/ProfilePictureUpload';
import PrizeRedemption from '@/components/PrizeRedemption';

export default function ProfilePage() {
  const { user, isLoading } = useAuth();
  const { profile, loading: profileLoading, error: profileError, refreshProfile } = useProfile();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const mobileKeywords = ['mobile', 'android', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone'];
      const isMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));
      const isMobileWidth = window.innerWidth <= 768;
      setIsMobile(isMobileUA || isMobileWidth);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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

      // Refresh profile to get updated picture
      await refreshProfile();

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

    // Profile data is managed by ProfileContext
    setLoading(false);
  }, [user, isLoading, router]);

  if (isLoading || loading || profileLoading) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        {/* Animated Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
          {!isMobile && (
            <>
              <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%224%22/%3E%3C/g%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20"></div>
              <div className="absolute top-0 left-0 w-full h-full">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
              </div>
            </>
          )}
        </div>

        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="relative">
              {!isMobile && (
                <div className="w-20 h-20 mx-auto mb-6 relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full animate-spin"></div>
                  <div className="absolute inset-2 bg-slate-900 rounded-full flex items-center justify-center">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full"></div>
                  </div>
                </div>
              )}
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

  if (profileError) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        {/* Animated Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
          {!isMobile && (
            <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%139C92AC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%224%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20"></div>
          )}
        </div>

        <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
          <div className={`${isMobile ? 'bg-slate-800/90' : 'backdrop-blur-xl bg-white/5 border border-white/10'} rounded-2xl p-8 text-center max-w-md w-full`}>
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-red-400 to-pink-400 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Profile Error</h2>
            <p className="text-slate-300 mb-6">{profileError}</p>
            <button
              onClick={() => refreshProfile()}
              className={`w-full px-6 py-3 bg-gradient-to-r from-red-500 to-pink-500 text-white font-semibold rounded-xl ${!isMobile ? 'hover:from-red-600 hover:to-pink-600 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-red-500/25' : ''}`}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        {/* Animated Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
          {!isMobile && (
            <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%139C92AC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%224%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20"></div>
          )}
        </div>

        <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
          <div className={`${isMobile ? 'bg-slate-800/90' : 'backdrop-blur-xl bg-white/5 border border-white/10'} rounded-2xl p-8 text-center max-w-md w-full`}>
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">No Profile Data</h2>
            <p className="text-slate-300 mb-6">Unable to load your profile information</p>
            <button
              onClick={() => refreshProfile()}
              className={`w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold rounded-xl ${!isMobile ? 'hover:from-blue-600 hover:to-purple-600 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-blue-500/25' : ''}`}
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
      {/* Animated Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        {!isMobile && (
          <>
            <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%139C92AC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%224%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20"></div>
            <div className="absolute top-0 left-0 w-full h-full">
              <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
              <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
              <div className="absolute top-3/4 left-1/2 w-64 h-64 bg-pink-500/10 rounded-full blur-3xl animate-pulse delay-2000"></div>
            </div>
          </>
        )}
      </div>

      <div className="relative z-10 container mx-auto px-4 py-6 lg:py-12">
        <div className="max-w-7xl mx-auto space-y-6 lg:space-y-8">

          {/* Profile Header Card */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl lg:rounded-3xl overflow-hidden shadow-2xl">
            <div className="relative">
              {/* Header Background */}
              <div className="absolute inset-0 bg-gradient-to-r from-purple-600/20 via-blue-600/20 to-pink-600/20"></div>
              <div className="relative p-6 lg:p-10">
                <div className="flex flex-col lg:flex-row items-center lg:items-start gap-6 lg:gap-8">

                  {/* Profile Picture Section */}
                  <div className="flex-shrink-0">
                    <ProfilePictureUpload
                      currentImage={profile?.profilePicture || undefined}
                      onImageUpload={handleImageUpload}
                      loading={uploadLoading}
                    />
                  </div>

                  {/* Profile Info */}
                  <div className="text-center lg:text-left flex-1">
                    <h1 className="text-2xl lg:text-4xl font-bold bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 bg-clip-text text-transparent mb-2">
                      {profile?.name}
                    </h1>
                    <p className="text-slate-300 text-lg mb-2">{profile?.email}</p>
                    <p className="text-slate-400 text-sm">
                      Member since {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      }) : 'N/A'}
                    </p>

                    {/* Quick Actions */}
                    <div className="flex flex-col sm:flex-row gap-3 mt-6">
                      <Link
                        href="/profile/edit"
                        className={`px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 text-white font-semibold rounded-xl text-center ${!isMobile ? 'hover:from-purple-600 hover:to-blue-600 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-purple-500/25' : ''}`}
                      >
                        Edit Profile
                      </Link>
                      <Link
                        href="/profile/change-password"
                        className={`px-6 py-3 backdrop-blur-xl bg-white/10 border border-white/20 text-white font-semibold rounded-xl text-center ${!isMobile ? 'hover:bg-white/20 transform hover:scale-105 transition-all duration-200' : ''}`}
                      >
                        Change Password
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 lg:gap-6">
            {/* Points Card */}
            <div className={`col-span-2 lg:col-span-1 backdrop-blur-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-2xl p-6 text-center group shadow-lg ${!isMobile ? 'hover:scale-105 transition-all duration-300 hover:shadow-yellow-500/25' : ''}`}>
              <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                </svg>
              </div>
              <p className="text-yellow-200 text-sm font-medium mb-1">Total Points</p>
              <p className="text-2xl lg:text-3xl font-bold text-white">{profile?.points || 0}</p>
            </div>

            {/* Quizzes Taken */}
            <div className={`backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 text-center group shadow-lg ${!isMobile ? 'hover:scale-105 transition-all duration-300 hover:shadow-blue-500/25' : ''}`}>
              <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-slate-300 text-sm font-medium mb-1">Quizzes Taken</p>
              <p className="text-2xl lg:text-3xl font-bold text-white">{profile?.quizzesTaken || 0}</p>
            </div>

            {/* Correct Answers */}
            <div className={`backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 text-center group shadow-lg ${!isMobile ? 'hover:scale-105 transition-all duration-300 hover:shadow-green-500/25' : ''}`}>
              <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-r from-green-400 to-emerald-400 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-slate-300 text-sm font-medium mb-1">Correct Answers</p>
              <p className="text-2xl lg:text-3xl font-bold text-white">{profile?.correctAnswers || 0}</p>
            </div>

            {/* Total Score */}
            <div className={`backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 text-center group shadow-lg ${!isMobile ? 'hover:scale-105 transition-all duration-300 hover:shadow-purple-500/25' : ''}`}>
              <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <p className="text-slate-300 text-sm font-medium mb-1">Total Score</p>
              <p className="text-2xl lg:text-3xl font-bold text-white">{profile?.totalScore || 0}</p>
            </div>

            {/* Wins */}
            <div className={`backdrop-blur-xl bg-gradient-to-br from-emerald-500/20 to-green-500/20 border border-emerald-500/30 rounded-2xl p-6 text-center group shadow-lg ${!isMobile ? 'hover:scale-105 transition-all duration-300 hover:shadow-emerald-500/25' : ''}`}>
              <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-r from-emerald-400 to-green-400 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
              </div>
              <p className="text-emerald-200 text-sm font-medium mb-1">Total Wins</p>
              <p className="text-2xl lg:text-3xl font-bold text-white">{profile?.winCount || 0}</p>
            </div>
          </div>

          {/* Prizes Section */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl lg:rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-6 lg:p-8 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-xl lg:text-2xl font-bold bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
                  Your Prizes
                </h2>
              </div>
            </div>

            <div className="p-6 lg:p-8">
              {profile?.prizes && profile.prizes.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {profile.prizes.map((prize) => (
                    <div key={prize.id} className="group">
                      <div className={`backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden transition-all duration-300 shadow-lg ${!isMobile ? 'hover:bg-white/10 transform hover:scale-105 hover:shadow-xl' : ''}`}>
                        <div className="aspect-square bg-gradient-to-br from-purple-500/10 to-blue-500/10 flex items-center justify-center p-6">
                          <Image
                            src={prize.image}
                            alt={prize.name}
                            width={120}
                            height={120}
                            className={`w-full h-full object-contain transition-transform duration-300 ${!isMobile ? 'group-hover:scale-110' : ''}`}
                          />
                        </div>
                        <div className="p-4">
                          <h3 className="font-semibold text-white mb-1 truncate">{prize.name}</h3>
                          <div className="flex items-center justify-between">
                            <p className="text-slate-400 text-xs">
                              {prize.type === 'quiz_win' ? 'Quiz Win' : 'Redeemed'}
                            </p>
                            <div className="flex items-center gap-1">
                              {prize.status === 'pending' && (
                                <>
                                  <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                                  <span className="text-yellow-400 text-xs font-medium">Pending</span>
                                </>
                              )}
                              {prize.status === 'approved' && (
                                <>
                                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                                  <span className="text-green-400 text-xs font-medium">Approved</span>
                                </>
                              )}
                              {prize.status === 'fulfilled' && (
                                <>
                                  <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                                  <span className="text-blue-400 text-xs font-medium">Delivered</span>
                                </>
                              )}
                              {prize.status === 'rejected' && (
                                <>
                                  <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                                  <span className="text-red-400 text-xs font-medium">Rejected</span>
                                </>
                              )}
                              {(prize.status === 'claimed' || prize.status === 'unclaimed') && (
                                <>
                                  <div className={`w-2 h-2 rounded-full ${prize.status === 'claimed' ? 'bg-green-400' : 'bg-gray-400'}`}></div>
                                  <span className={`text-xs font-medium ${prize.status === 'claimed' ? 'text-green-400' : 'text-gray-400'}`}>
                                    {prize.status === 'claimed' ? 'Claimed' : 'Unclaimed'}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <p className="text-slate-500 text-xs mt-1">
                            {new Date(prize.dateWon).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                            {prize.pointsUsed && (
                              <span className="ml-2 text-purple-400">• {prize.pointsUsed} pts</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">No Prizes Yet</h3>
                  <p className="text-slate-400 mb-6 max-w-md mx-auto">
                    You haven&apos;t won any prizes yet. Keep playing quizzes for a chance to win amazing rewards!
                  </p>
                  <Link
                    href="/quizzes"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 text-white font-semibold rounded-xl md:hover:from-purple-600 md:hover:to-blue-600 md:transform md:hover:scale-105 md:transition-all md:duration-200 shadow-lg md:hover:shadow-purple-500/25 touch-manipulation"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Start Playing
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Prize Redemption Section */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl lg:rounded-3xl overflow-hidden shadow-2xl">
            <PrizeRedemption />
          </div>

          {/* Quiz History */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl lg:rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-6 lg:p-8 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-xl lg:text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Quiz History
                </h2>
              </div>
            </div>

            <div className="p-6 lg:p-8">
              {profile?.quizHistory && profile.quizHistory.length > 0 ? (
                <div className="overflow-x-auto">
                  <div className="min-w-full">
                    {/* Desktop Table */}
                    <div className="hidden lg:block">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-4 px-6 text-slate-300 font-semibold">Quiz</th>
                            <th className="text-left py-4 px-6 text-slate-300 font-semibold">Date</th>
                            <th className="text-left py-4 px-6 text-slate-300 font-semibold">Score</th>
                            <th className="text-left py-4 px-6 text-slate-300 font-semibold">Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profile.quizHistory.map((attempt) => {
                            const hasWinnings = attempt.winnings && attempt.winnings.length > 0;
                            const formattedDate = new Date(attempt.createdAt).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            });

                            return (
                              <tr key={attempt.id} className="border-b border-white/5 hover:bg-white/5 transition-colors duration-200">
                                <td className="py-4 px-6">
                                  <div className="font-medium text-white">{attempt.quiz.title}</div>
                                </td>
                                <td className="py-4 px-6 text-slate-300">{formattedDate}</td>
                                <td className="py-4 px-6">
                                  <div className="flex items-center gap-2">
                                    <span className="text-white font-semibold">
                                      {attempt.score}/{attempt.quiz._count.questions}
                                    </span>
                                    <div className="w-16 bg-slate-700 rounded-full h-2 overflow-hidden">
                                      <div
                                        className="bg-gradient-to-r from-blue-400 to-purple-400 h-2 rounded-full transition-all duration-300"
                                        style={{ width: `${Math.min(100, Math.max(0, (attempt.score / Math.max(1, attempt.quiz._count.questions)) * 100))}%` }}
                                      ></div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-4 px-6">
                                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${hasWinnings
                                      ? 'bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-300 border border-emerald-500/30'
                                      : 'bg-gradient-to-r from-slate-500/20 to-gray-500/20 text-slate-300 border border-slate-500/30'
                                    }`}>
                                    {hasWinnings ? '🏆 Winner' : '👤 Participant'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="lg:hidden space-y-4">
                      {profile.quizHistory.map((attempt) => {
                        const hasWinnings = attempt.winnings && attempt.winnings.length > 0;
                        const formattedDate = new Date(attempt.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        });

                        return (
                          <div key={attempt.id} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-xl p-4">
                            <div className="flex justify-between items-start mb-3">
                              <h3 className="font-semibold text-white text-sm">{attempt.quiz.title}</h3>
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${hasWinnings
                                  ? 'bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-gradient-to-r from-slate-500/20 to-gray-500/20 text-slate-300 border border-slate-500/30'
                                }`}>
                                {hasWinnings ? '🏆 Winner' : '👤 Participant'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-slate-300">{formattedDate}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-white font-semibold">
                                  {attempt.score}/{attempt.quiz._count.questions}
                                </span>
                                <div className="w-12 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className="bg-gradient-to-r from-blue-400 to-purple-400 h-1.5 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.min(100, Math.max(0, (attempt.score / Math.max(1, attempt.quiz._count.questions)) * 100))}%` }}
                                  ></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">No Quiz History</h3>
                  <p className="text-slate-400 mb-6 max-w-md mx-auto">
                    You haven&apos;t taken any quizzes yet. Start your quiz journey today!
                  </p>
                  <Link
                    href="/quizzes"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-purple-600 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-blue-500/25"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Browse Quizzes
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}