'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';

export type QuizAttempt = {
  id: string;
  score: number;
  createdAt: string;
  quiz: {
    id: string;
    title: string;
    description?: string;
    _count: {
      questions: number;
    };
  };
  answers: Array<{
    id: string;
    isCorrect: boolean;
    question: {
      id: string;
      text: string;
    };
  }>;
  winnings: Array<{
    id: string;
    prize: {
      id: string;
      name: string;
      type: string;
      value?: number;
    };
  }>;
};

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  profilePicture?: string | null;
  createdAt: string;
  points: number;
  quizzesTaken: number;
  correctAnswers: number;
  totalScore: number;
  winCount: number;
  quizHistory: QuizAttempt[];
  prizes: Array<{
    id: string;
    name: string;
    image: string;
    dateWon: string;
    type?: string; // 'quiz_win' or 'redemption'
    status?: string;
    pointsUsed?: number;
  }>;
};

type ProfileContextType = {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  updateProfile: (data: { name: string; email: string }) => Promise<void>;
  uploadProfilePicture: (file: File) => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
};

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (authLoading) {
      return;
    }

    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Try to fetch from API first
      const response = await fetch('/api/profile');

      if (response.ok) {
        const data = await response.json();

        // Calculate statistics from quiz history
        const quizHistory = data.quizHistory || [];
        const totalScore = quizHistory.reduce((sum: number, attempt: QuizAttempt) => sum + attempt.score, 0);
        const correctAnswers = quizHistory.reduce((sum: number, attempt: QuizAttempt) => {
          return sum + attempt.answers.filter(answer => answer.isCorrect).length;
        }, 0);

        // Map API response to ProfileContext structure
        const mappedProfile: UserProfile = {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          profilePicture: data.user.profilePicture,
          createdAt: data.user.createdAt,
          points: data.user.points || 0,
          quizzesTaken: data.user.totalQuizAttempts || 0,
          correctAnswers: correctAnswers,
          totalScore: totalScore,
          winCount: data.user.totalWinnings || 0,
          quizHistory: quizHistory,
          prizes: data.recentWinnings?.map((prizeData: { id: string; prize: { name: string; type: string }; dateWon: string; type: string; status: string; pointsUsed: number }) => ({
            id: prizeData.id,
            name: prizeData.prize.name,
            image: `/${prizeData.prize.type}.svg`,
            dateWon: prizeData.dateWon,
            type: prizeData.type, // 'quiz_win' or 'redemption'
            status: prizeData.status,
            pointsUsed: prizeData.pointsUsed,
          })) || [],
        };

        setProfile(mappedProfile);
      } else {
        // Use Supabase user data as fallback
        const userName = user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
        const fallbackProfile: UserProfile = {
          id: user.id,
          name: userName,
          email: user.email || 'user@example.com',
          profilePicture: user.user_metadata?.avatar_url || null,
          createdAt: user.created_at || new Date().toISOString(),
          points: 0,
          quizzesTaken: 0,
          correctAnswers: 0,
          totalScore: 0,
          winCount: 0,
          quizHistory: [],
          prizes: [],
        };
        setProfile(fallbackProfile);
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
      // Use Supabase user data as fallback
      if (user) {
        const userName = user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
        const fallbackProfile: UserProfile = {
          id: user.id,
          name: userName,
          email: user.email || 'user@example.com',
          profilePicture: user.user_metadata?.avatar_url || null,
          createdAt: user.created_at || new Date().toISOString(),
          points: 0,
          quizzesTaken: 0,
          correctAnswers: 0,
          totalScore: 0,
          winCount: 0,
          quizHistory: [],
          prizes: [],
        };
        setProfile(fallbackProfile);
      }
      setError('Failed to load profile data');
    } finally {
      setLoading(false);
    }
  }, [authLoading, user]);

  const updateProfile = async (data: { name: string; email: string }) => {
    try {
      setError(null);

      // Get CSRF token
      const getCSRFToken = async () => {
        const csrfResponse = await fetch('/api/csrf-token', {
          credentials: 'include'
        });
        if (!csrfResponse.ok) {
          throw new Error('Failed to get CSRF token');
        }
        const csrfData = await csrfResponse.json();
        return csrfData.csrfToken;
      };

      const csrfToken = await getCSRFToken();

      const response = await fetch('/api/profile/update', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || 'Failed to update profile');
      }

      const updatedProfile = await response.json();

      // Update local state immediately for real-time updates
      setProfile(prev => prev ? { ...prev, ...updatedProfile.user } : updatedProfile.user);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update profile';
      setError(errorMessage);
      throw err; // Re-throw to allow component to handle it
    }
  };

  const uploadProfilePicture = async (file: File) => {
    try {
      setError(null);

      // Get CSRF token
      const getCSRFToken = async () => {
        const csrfResponse = await fetch('/api/csrf-token', {
          credentials: 'include'
        });
        if (!csrfResponse.ok) {
          throw new Error('Failed to get CSRF token');
        }
        const csrfData = await csrfResponse.json();
        return csrfData.csrfToken;
      };

      const csrfToken = await getCSRFToken();

      const formData = new FormData();
      formData.append('profilePicture', file);

      const response = await fetch('/api/profile/upload-picture', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to upload profile picture');
      }

      const result = await response.json();

      // Update local state immediately
      setProfile(prev => prev ? { ...prev, profilePicture: result.imageUrl } : null);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload profile picture';
      setError(errorMessage);
      throw err;
    }
  };

  const refreshProfile = async () => {
    await fetchProfile();
  };

  const clearError = () => {
    setError(null);
  };

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const value: ProfileContextType = {
    profile,
    loading,
    error,
    updateProfile,
    uploadProfilePicture,
    refreshProfile,
    clearError,
  };

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}