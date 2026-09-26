'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useProfile } from '@/contexts/ProfileContext';
import ProfilePictureUpload from '@/components/ProfilePictureUpload';
import { ProfileHeader, ProfileAvatar, BalanceCard, QuickActions, StatsGrid, ChangePasswordModal } from '@/components/profile';

// Dynamic import for large component
const PrizeRedemption = dynamic(
  () => import('@/components/PrizeRedemption'),
  {
    loading: () => (
      <div className="p-6 space-y-4 animate-pulse" role="status" aria-label="Loading prizes">
        <div className="h-8 bg-white/10 rounded w-48" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-white/5 rounded-xl" />
          ))}
        </div>
      </div>
    ),
    ssr: false
  }
);

export default function ProfilePage() {
  const { user, isLoading } = useAuth();
  const { profile, loading: profileLoading, error: profileError, refreshProfile } = useProfile();
  const router = useRouter();
  const [uploadLoading, setUploadLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [walletEnabled, setWalletEnabled] = useState(true); // default true to avoid flicker

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

    // Fetch wallet feature flag — hide BalanceCard if disabled
    fetch('/api/settings/wallet-enabled')
      .then(r => r.json())
      .then((d: { walletEnabled: boolean }) => setWalletEnabled(d.walletEnabled))
      .catch(() => {}); // on error keep default (true)
  }, [user, isLoading, router]);

  // Derive verification status from Supabase auth (no new fields needed).
  const verification = useMemo(() => {
    const emailVerified = Boolean((user as any)?.email_confirmed_at);
    const provider = (user as any)?.app_metadata?.provider || (user as any)?.provider || 'email';
    return { emailVerified, provider };
  }, [user]);

  const memberSince = useMemo(() => {
    if (!profile?.createdAt) return null;
    return new Date(profile.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short'
    });
  }, [profile?.createdAt]);

  const stats = [
    {
      id: 'points',
      label: 'Total Points',
      value: profile?.points || 0,
      icon: (
        <svg className="w-5 h-5 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
        </svg>
      ),
      gradient: 'bg-gradient-to-br from-amber-500/20 to-orange-500/15',
    },
    {
      id: 'quizzes',
      label: 'Quizzes Taken',
      value: profile?.quizzesTaken || 0,
      icon: (
        <svg className="w-5 h-5 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: 'correct',
      label: 'Correct Answers',
      value: profile?.correctAnswers || 0,
      icon: (
        <svg className="w-5 h-5 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    {
      id: 'wins',
      label: 'Total Wins',
      value: profile?.winCount || 0,
      icon: (
        <svg className="w-5 h-5 text-amber-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
        </svg>
      ),
      gradient: 'bg-gradient-to-br from-amber-500/20 to-amber-700/15',
    },
  ];

  // Loading state
  if (isLoading || profileLoading) {
    return (
      <div className="min-h-screen relative overflow-hidden" role="status" aria-label="Loading profile">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900" aria-hidden="true">
          <div className="absolute top-0 left-0 w-full h-full">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse"></div>
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-6 relative">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full animate-spin" aria-hidden="true"></div>
              <div className="absolute inset-2 bg-slate-900 rounded-full flex items-center justify-center">
                <div className="w-8 h-8 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full" aria-hidden="true"></div>
              </div>
            </div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent mb-2">
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
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900" aria-hidden="true"></div>
        <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] p-8 text-center max-w-md w-full" role="alert">
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-rose-500 to-red-500 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Profile Error</h2>
            <p className="text-slate-300 mb-6">{profileError}</p>
            <button
              type="button"
              onClick={() => refreshProfile()}
              className="w-full px-6 py-3 bg-gradient-to-r from-rose-700 to-red-700 text-white font-semibold rounded-2xl hover:from-rose-800 hover:to-red-800 transform hover:scale-105 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
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
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900" aria-hidden="true"></div>
        <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] p-8 text-center max-w-md w-full">
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-emerald-700 to-teal-700 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">No Profile Data</h2>
            <p className="text-slate-300 mb-6">Unable to load your profile information</p>
            <button
              type="button"
              onClick={() => refreshProfile()}
              className="w-full px-6 py-3 bg-gradient-to-r from-emerald-700 to-teal-700 text-white font-semibold rounded-2xl hover:from-emerald-800 hover:to-teal-800 transform hover:scale-105 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
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
      {/* Background - theme-aligned emerald + blue */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900" aria-hidden="true">
        <div className="absolute top-0 left-0 w-full h-full">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
          <div className="absolute top-3/4 left-1/2 w-64 h-64 bg-amber-500/8 rounded-full blur-3xl animate-pulse delay-2000"></div>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 py-6 lg:py-8">
        <div className="max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto space-y-6 lg:space-y-8">

          {/* Header */}
          <ProfileHeader title="Profile" backHref="/" />

          {/* IDENTITY CARD - at-a-glance core profile data */}
          <section
            aria-label="Profile identity"
            className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] p-5 lg:p-6"
          >
            <div className="flex flex-col lg:flex-row items-center lg:items-start gap-5 lg:gap-6">
              <button
                type="button"
                onClick={() => setShowUploadModal(true)}
                className="block relative group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 rounded-full"
                aria-label="Update profile picture"
              >
                <ProfileAvatar
                  imageSrc={profile.profilePicture}
                  name={profile.name}
                  userId={profile.id.slice(0, 8)}
                />
                <div
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
                  aria-hidden="true"
                >
                  <div className="w-32 h-32 rounded-full bg-black/50 flex items-center justify-center">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                </div>
              </button>

              <div className="flex-1 w-full text-center lg:text-left">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3">
                  <h1 className="text-2xl lg:text-3xl font-bold text-white">
                    {profile.name}
                  </h1>
                  {/* Verification status - first-class badge */}
                  <span
                    className={`inline-flex items-center justify-center gap-1.5 self-center lg:self-auto px-2.5 py-1 rounded-full text-xs font-medium border ${
                      verification.emailVerified
                        ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200'
                        : 'bg-amber-500/15 border-amber-400/30 text-amber-200'
                    }`}
                    aria-label={
                      verification.emailVerified
                        ? `Email verified${verification.provider ? ` via ${verification.provider}` : ''}`
                        : 'Email not verified yet'
                    }
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      {verification.emailVerified ? (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M5 13l4 4L19 7"
                        />
                      ) : (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-2.5L13.73 4a2 2 0 00-3.46 0L3.34 16.5C2.56 17.33 3.53 19 5.07 19z"
                        />
                      )}
                    </svg>
                    {verification.emailVerified
                      ? `Verified${verification.provider && verification.provider !== 'email' ? ` · ${verification.provider}` : ''}`
                      : 'Unverified'}
                  </span>
                </div>

                {/* Account creation date - prominent */}
                <p className="mt-2 text-slate-300 text-sm">
                  <span className="text-slate-400">Member since </span>
                  <span className="font-semibold text-white">
                    {memberSince ?? 'N/A'}
                  </span>
                </p>

                <p className="mt-1 text-slate-400 text-xs font-mono break-all">
                  ID: {profile.id}
                </p>
              </div>
            </div>
          </section>

          {/* Balance Card — hidden when wallet feature is disabled */}
          {walletEnabled && <BalanceCard balance={profile.walletBalance || 0} />}

          {/* Quick Actions */}
          <QuickActions
            onChangePasswordClick={() => setShowPasswordModal(true)}
            hideWalletActions={!walletEnabled}
          />

          {/* Stats Grid */}
          <StatsGrid stats={stats} />

          {/* Prizes Section */}
          <section className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden" aria-label="Your prizes">
            <div className="p-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 bg-gradient-to-r from-amber-500 to-amber-700 rounded-full flex items-center justify-center"
                  aria-hidden="true"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white">Your Prizes</h2>
                {profile.prizes && profile.prizes.length > 0 && (
                  <span
                    className="ml-auto text-xs font-medium text-amber-200 bg-amber-500/15 border border-amber-400/30 rounded-full px-2 py-0.5"
                    aria-label={`${profile.prizes.length} prizes`}
                  >
                    {profile.prizes.length}
                  </span>
                )}
              </div>
            </div>

            <div className="p-5">
              {profile.prizes && profile.prizes.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4">
                  {profile.prizes.slice(0, 4).map((prize) => {
                    const status = (prize.status || 'pending').toLowerCase();
                    const statusStyles =
                      status === 'pending'
                        ? { dot: 'bg-amber-400', text: 'text-amber-200', label: 'Pending' }
                        : status === 'approved'
                        ? { dot: 'bg-emerald-400', text: 'text-emerald-200', label: 'Approved' }
                        : status === 'fulfilled'
                        ? { dot: 'bg-blue-400', text: 'text-blue-200', label: 'Fulfilled' }
                        : status === 'rejected'
                        ? { dot: 'bg-rose-400', text: 'text-rose-200', label: 'Rejected' }
                        : { dot: 'bg-slate-400', text: 'text-slate-200', label: 'Unknown' };
                    return (
                      <div
                        key={prize.id}
                        className="group backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-emerald-400/70"
                      >
                        <div
                          className="aspect-square bg-gradient-to-br from-amber-500/10 to-amber-700/10 flex items-center justify-center p-4"
                          aria-hidden="true"
                        >
                          <Image
                            src={prize.image}
                            alt={prize.name}
                            width={80}
                            height={80}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="p-3">
                          <h3 className="font-medium text-white text-sm truncate">
                            {prize.name}
                          </h3>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span
                              className={`w-2 h-2 rounded-full ${statusStyles.dot}`}
                              aria-hidden="true"
                            />
                            <span className={`text-xs font-medium ${statusStyles.text}`}>
                              {statusStyles.label}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div
                    className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-amber-700/30 to-amber-800/30 rounded-full flex items-center justify-center"
                    aria-hidden="true"
                  >
                    <svg className="w-8 h-8 text-amber-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h3 className="text-white font-semibold mb-2">No Prizes Yet</h3>
                  <p className="text-slate-400 text-sm mb-4">Play quizzes to win rewards!</p>
                  <Link
                    href="/quizzes"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-700 to-teal-700 text-white text-sm font-semibold rounded-xl hover:from-emerald-800 hover:to-teal-800 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                  >
                    Start Playing
                  </Link>
                </div>
              )}
              {profile.prizes && profile.prizes.length > 4 && (
                <Link
                  href="/prizes"
                  className="block mt-4 text-center text-sm text-emerald-300 hover:text-emerald-200 focus-visible:outline-none focus-visible:underline"
                >
                  View all {profile.prizes.length} prizes →
                </Link>
              )}
            </div>
          </section>

          {/* Prize Redemption */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden">
            <PrizeRedemption />
          </div>

          {/* Quiz History */}
          <section className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden" aria-label="Quiz history">
            <div className="p-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 bg-gradient-to-r from-blue-600 to-blue-800 rounded-full flex items-center justify-center"
                  aria-hidden="true"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white">Quiz History</h2>
                {profile.quizHistory && profile.quizHistory.length > 0 && (
                  <span
                    className="ml-auto text-xs font-medium text-blue-200 bg-blue-500/15 border border-blue-400/30 rounded-full px-2 py-0.5"
                    aria-label={`${profile.quizHistory.length} attempts`}
                  >
                    {profile.quizHistory.length}
                  </span>
                )}
              </div>
            </div>

            <div className="p-5 lg:p-6">
              {profile.quizHistory && profile.quizHistory.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
                  {profile.quizHistory.slice(0, 6).map((attempt) => {
                    const hasWinnings = attempt.winnings && attempt.winnings.length > 0;
                    const scorePercent = Math.min(100, Math.max(0, (attempt.score / Math.max(1, attempt.quiz._count.questions)) * 100));

                    return (
                      <article
                        key={attempt.id}
                        aria-label={`${attempt.quiz.title}, score ${attempt.score} of ${attempt.quiz._count.questions}`}
                        className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                        tabIndex={0}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-medium text-white text-sm truncate flex-1 mr-2">
                            {attempt.quiz.title}
                          </h3>
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                              hasWinnings
                                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30'
                                : 'bg-slate-500/20 text-slate-300 border border-slate-400/30'
                            }`}
                          >
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
                            <span className="text-white text-sm font-medium tabular-nums">
                              {attempt.score}/{attempt.quiz._count.questions}
                            </span>
                            <div
                              className="w-16 bg-slate-700 rounded-full h-1.5 overflow-hidden"
                              role="progressbar"
                              aria-valuenow={Math.round(scorePercent)}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label="Score percentage"
                            >
                              <div
                                className="bg-gradient-to-r from-emerald-400 to-teal-400 h-1.5 rounded-full"
                                style={{ width: `${scorePercent}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div
                    className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-blue-600/20 to-blue-800/20 rounded-full flex items-center justify-center"
                    aria-hidden="true"
                  >
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-white font-semibold mb-2">No Quiz History</h3>
                  <p className="text-slate-400 text-sm mb-4">Start your quiz journey today!</p>
                  <Link
                    href="/quizzes"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-700 to-teal-700 text-white text-sm font-semibold rounded-xl hover:from-emerald-800 hover:to-teal-800 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                  >
                    Browse Quizzes
                  </Link>
                </div>
              )}
              {profile.quizHistory && profile.quizHistory.length > 6 && (
                <Link
                  href="/quizzes"
                  className="block mt-4 text-center text-sm text-emerald-300 hover:text-emerald-200 focus-visible:outline-none focus-visible:underline"
                >
                  View all history →
                </Link>
              )}
            </div>
          </section>

        </div>
      </div>

      {/* Profile Picture Upload Modal */}
      {showUploadModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-picture-upload-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        >
          <div className="backdrop-blur-xl bg-slate-900/95 border border-white/10 rounded-[32px] p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-6">
              <h3 id="profile-picture-upload-title" className="text-lg font-bold text-white">
                Update Profile Picture
              </h3>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                aria-label="Close update profile picture dialog"
                className="w-8 h-8 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </div>
  );
}
