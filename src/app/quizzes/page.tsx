'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import LazyStreamPlayer from '@/components/LazyStreamPlayer';

interface Quiz {
  id: string;
  title: string;
  description: string;
  duration: number;
  passingScore: number;
  status: string;
  questionCount: number;
  hasAccess: boolean;
  createdAt: string;
  updatedAt: string;
  isCompleted?: boolean;
  hasNewQuestions?: boolean;
  newQuestionsCount?: number;
  lastAttemptDate?: string;
}

interface PaymentInfo {
  id: string;
  expiresAt: string;
  timeRemaining: number;
}

export default function QuizzesPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    fetchQuizzes();
  }, [user, isLoading, router]);

  // Update time remaining every second
  useEffect(() => {
    if (!paymentInfo) return;

    const updateTimer = () => {
      const now = new Date().getTime();
      const expiry = new Date(paymentInfo.expiresAt).getTime();
      const remaining = expiry - now;

      if (remaining <= 0) {
        setTimeRemaining('Expired');
        setHasAccess(false);
        setPaymentInfo(null);
        return;
      }

      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

      setTimeRemaining(`${hours}h ${minutes}m ${seconds}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [paymentInfo]);

  const fetchQuizzes = async () => {
    try {
      const response = await fetch('/api/quizzes', { cache: 'no-store' });
      if (response.status === 304) {
        setLoading(false);
        return;
      }
      if (!response.ok) {
        try {
          const errorData = await response.json();
          if (response.status === 429) {
            setError(errorData.message || 'Too many requests. Please try again later.');
          } else if (typeof errorData.error === 'string') {
            setError(errorData.error);
          } else {
            setError('Failed to fetch quizzes');
          }
        } catch {
          setError('Failed to fetch quizzes');
        }
        return;
      }
      const data = await response.json();
      setQuizzes(data.quizzes || []);
      setHasAccess(data.hasAccess || false);
      setPaymentInfo(data.paymentInfo);
      setError(data.accessError || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quizzes');
    } finally {
      setLoading(false);
    }
  };

  const handleQuizClick = (quiz: Quiz) => {
    if (hasAccess) {
      // User has access, redirect to quiz
      router.push(`/quiz/${quiz.id}`);
    } else {
      // Show payment modal
      setShowPaymentModal(true);
    }
  };

  const getCSRFToken = async () => {
    try {
      const response = await fetch('/api/csrf-token');
      if (!response.ok) {
        throw new Error('Failed to fetch CSRF token');
      }
      const data = await response.json();
      return data.csrfToken;
    } catch (error) {
      console.error('Failed to get CSRF token:', error);
      return null;
    }
  };

  const handlePayment = async () => {
    setPaymentLoading(true);
    try {
      const csrfToken = await getCSRFToken();
      if (!csrfToken) {
        throw new Error('Failed to obtain security token. Please try again.');
      }

      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          paymentMethod: 'demo',
          transactionId: `demo_${Date.now()}`
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Payment failed');
      }

      const data = await response.json();
      setHasAccess(true);
      setPaymentInfo(data.payment);
      setShowPaymentModal(false);
      setError(null);

      // Refresh quizzes to update access status
      fetchQuizzes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setPaymentLoading(false);
    }
  };

  if (isLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-white">Loading quizzes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-glass-dark py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">Available Quizzes</h1>
          <p className="text-gray-300 text-lg">
            {hasAccess
              ? "You have full access to all quizzes!"
              : "Choose a quiz to play or get 24-hour access for just 2 PKR"
            }
          </p>
        </div>

        {/* Live Stream (visible when admin embed is set) */}
        <div className="mb-8">
          <div className="glass-card glass-border rounded-2xl p-4">
            <LazyStreamPlayer autoPlay={false} />
          </div>
        </div>

        {/* Access Status */}
        {hasAccess && paymentInfo && (
          <div className="mb-6 p-4 bg-green-500/20 border border-green-500/30 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg className="w-6 h-6 text-green-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-green-200 font-medium">You have 24-hour access to all quizzes!</p>
              </div>
              <div className="text-green-200 font-mono text-sm">
                {timeRemaining}
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 rounded-xl">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* Quizzes Grid */}
        {quizzes.length === 0 ? (
          <div className="text-center py-12">
            <div className="glass-card glass-border rounded-2xl p-8">
              <h3 className="text-2xl font-bold text-white mb-4">No Active Quizzes</h3>
              <p className="text-gray-300 mb-6">
                There are no active quizzes at the moment. Check back later for new quizzes!
              </p>
              <Link
                href="/how-to-play"
                className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-purple-600 transition-all duration-200"
              >
                Learn How to Play
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {quizzes.map((quiz) => (
              <div key={quiz.id} className="glass-card glass-border glass-transition glass-hover rounded-2xl overflow-hidden">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-xl font-bold text-white">{quiz.title}</h3>
                    <div className="flex items-center space-x-2">
                      {/* New questions notification */}
                      {quiz.hasNewQuestions && (
                        <div className="px-2 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded-full text-xs font-medium">
                          +{quiz.newQuestionsCount} New
                        </div>
                      )}
                      <div className={`px-3 py-1 rounded-full text-xs font-medium ${quiz.status === 'active'
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                        }`}>
                        {quiz.status === 'active' ? 'Active' : 'Paused'}
                      </div>
                    </div>
                  </div>

                  {/* Reattempt notification */}
                  {quiz.hasNewQuestions && (
                    <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                      <p className="text-green-300 text-sm">
                        🎉 New questions added! You can reattempt this quiz to answer the new questions.
                      </p>
                      {quiz.lastAttemptDate && (
                        <p className="text-green-400 text-xs mt-1">
                          Last completed: {new Date(quiz.lastAttemptDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-gray-300 mb-4 line-clamp-3">{quiz.description}</p>

                  <div className="space-y-2 mb-6">
                    <div className="flex items-center text-sm text-gray-400">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {quiz.questionCount} Questions
                    </div>
                    <div className="flex items-center text-sm text-gray-400">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Duration: {quiz.duration} minutes
                    </div>
                    <div className="flex items-center text-sm text-gray-400">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Passing Score: {quiz.passingScore}%
                    </div>
                  </div>

                  {quiz.status !== 'active' ? (
                    <button
                      disabled
                      className="w-full py-3 px-4 bg-gray-600 text-gray-400 rounded-xl font-medium cursor-not-allowed"
                    >
                      Quiz Paused
                    </button>
                  ) : (
                    <button
                      onClick={() => handleQuizClick(quiz)}
                      className={`w-full py-3 px-4 rounded-xl font-medium transition-all duration-200 ${hasAccess
                          ? 'bg-gradient-to-r from-green-500 to-blue-500 text-white hover:from-green-600 hover:to-blue-600'
                          : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600'
                        }`}
                    >
                      {hasAccess ? 'Play Now' : 'Pay 2 PKR & Play'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Payment Modal */}
        {showPaymentModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="glass-card glass-border rounded-2xl p-6 max-w-md w-full">
              <h3 className="text-2xl font-bold text-white mb-4">Get 24-Hour Access</h3>
              <p className="text-gray-300 mb-6">
                Pay just 2 PKR to get unlimited access to all quizzes for 24 hours!
              </p>

              <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-white font-medium">24-Hour Access</span>
                  <span className="text-2xl font-bold text-white">2 PKR</span>
                </div>
                <p className="text-gray-300 text-sm mt-2">
                  Access all available quizzes without additional charges
                </p>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowPaymentModal(false)}
                  className="flex-1 py-3 px-4 glass-card glass-border text-gray-300 rounded-xl font-medium hover:bg-white/5 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePayment}
                  disabled={paymentLoading}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-medium hover:from-purple-600 hover:to-pink-600 transition-all duration-200 disabled:opacity-50"
                >
                  {paymentLoading ? 'Processing...' : 'Pay Now'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}