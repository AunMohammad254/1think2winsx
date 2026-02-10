'use client';

import { useState, useEffect, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Search, Filter, Clock, CheckCircle, Sparkles, Wallet, AlertTriangle } from 'lucide-react';
import QuizCard from '@/components/quiz/QuizCard';
import { QuizCardSkeletonGrid } from '@/components/quiz/QuizCardSkeleton';
import QuizDetailModal from '@/components/quiz/QuizDetailModal';
import QuizAttemptModal from '@/components/quiz/QuizAttemptModal';
import LazyStreamPlayer from '@/components/LazyStreamPlayer';
import { getWalletBalanceForDeduction, deductWalletForQuizAccess, getQuizAccessPrice } from '@/actions/wallet-deduction-actions';

interface Quiz {
  id: string;
  title: string;
  description: string;
  duration: number;
  passingScore: number;
  status: 'active' | 'paused';
  questionCount: number;
  hasAccess: boolean;
  createdAt: string;
  updatedAt: string;
  isCompleted?: boolean;
  hasNewQuestions?: boolean;
  newQuestionsCount?: number;
  lastAttemptDate?: string;
  score?: number;
  attemptCount?: number;
}

interface PaymentInfo {
  id: string;
  expiresAt: string;
  timeRemaining: number;
}

type FilterTab = 'all' | 'available' | 'completed' | 'new';

export default function QuizzesPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [showInsufficientBalanceModal, setShowInsufficientBalanceModal] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [accessPrice, setAccessPrice] = useState<number>(2);
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);
  const [attemptQuizId, setAttemptQuizId] = useState<string | null>(null);

  // Redirect to login if not authenticated
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
        toast.warning('Your 24-hour access has expired');
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
      toast.error('Failed to load quizzes');
    } finally {
      setLoading(false);
    }
  };

  const handleQuizClick = (quizId: string) => {
    const quiz = quizzes.find(q => q.id === quizId);
    if (!quiz) return;

    if (hasAccess) {
      setSelectedQuiz(quiz);
    } else {
      setShowPaymentModal(true);
    }
  };

  // Fetch wallet balance and access price when payment modal opens
  const fetchWalletData = async (): Promise<{ balance: number; price: number }> => {
    const [balanceResult, priceResult] = await Promise.all([
      getWalletBalanceForDeduction(),
      getQuizAccessPrice()
    ]);

    const balance = balanceResult.success ? (balanceResult.balance ?? 0) : 0;
    const price = priceResult.success ? (priceResult.price ?? 2) : 2;

    setWalletBalance(balance);
    setAccessPrice(price);

    return { balance, price };
  };

  // Handle "Pay Now" click - shows confirmation if sufficient balance, otherwise shows insufficient balance dialog
  const handlePayNowClick = async () => {
    setPaymentLoading(true);
    const { balance, price } = await fetchWalletData();
    setPaymentLoading(false);

    // Check if wallet balance is sufficient (use fetched values directly)
    if (balance >= price) {
      setShowPaymentModal(false);
      setShowConfirmationModal(true);
    } else {
      setShowPaymentModal(false);
      setShowInsufficientBalanceModal(true);
    }
  };

  // Handle confirmed wallet payment
  const handleConfirmedPayment = async () => {
    setPaymentLoading(true);
    try {
      const result = await deductWalletForQuizAccess(accessPrice);

      if (!result.success) {
        if (result.insufficientBalance) {
          setShowConfirmationModal(false);
          setShowInsufficientBalanceModal(true);
          return;
        }
        throw new Error(result.error || 'Payment failed');
      }

      setHasAccess(true);
      setWalletBalance(result.newBalance ?? 0);
      setShowConfirmationModal(false);
      setError(null);
      toast.success('Payment successful! You now have 24-hour access.');
      fetchQuizzes();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Payment failed';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setPaymentLoading(false);
    }
  };

  // Navigate to wallet page to add funds
  const handleGoToWallet = () => {
    setShowInsufficientBalanceModal(false);
    router.push('/profile/wallet');
  };

  // Filter quizzes based on active filter and search query
  const filteredQuizzes = quizzes.filter(quiz => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!quiz.title.toLowerCase().includes(query) &&
        !quiz.description?.toLowerCase().includes(query)) {
        return false;
      }
    }

    // Tab filter
    switch (activeFilter) {
      case 'available':
        return quiz.status === 'active' && !quiz.isCompleted;
      case 'completed':
        return quiz.isCompleted;
      case 'new':
        return quiz.hasNewQuestions;
      default:
        return true;
    }
  });

  const filterTabs: { key: FilterTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'all', label: 'All Quizzes', icon: <Filter className="w-4 h-4" />, count: quizzes.length },
    { key: 'available', label: 'Available', icon: <Clock className="w-4 h-4" />, count: quizzes.filter(q => q.status === 'active' && !q.isCompleted).length },
    { key: 'completed', label: 'Completed', icon: <CheckCircle className="w-4 h-4" />, count: quizzes.filter(q => q.isCompleted).length },
    { key: 'new', label: 'New Questions', icon: <Sparkles className="w-4 h-4" />, count: quizzes.filter(q => q.hasNewQuestions).length },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <QuizCardSkeletonGrid count={6} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white via-purple-200 to-white">
            Quiz Arena
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            {hasAccess
              ? 'You have full access to all quizzes! Choose one to test your knowledge.'
              : 'Unlock 24-hour access for just 2 PKR and play unlimited quizzes.'}
          </p>
        </div>

        {/* Access Status Banner */}
        {hasAccess && paymentInfo && (
          <div className="mb-8 p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-green-200 font-semibold">Full Access Active</p>
                  <p className="text-green-300/70 text-sm">Unlimited quizzes for 24 hours</p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/20">
                <Clock className="w-4 h-4 text-green-400" />
                <span className="font-mono text-green-300 font-medium">{timeRemaining}</span>
              </div>
            </div>
          </div>
        )}

        {/* Live Stream Section */}
        <div className="mb-8">
          <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-4">
            <Suspense fallback={<div className="h-64 bg-gray-800 rounded-xl animate-pulse" />}>
              <LazyStreamPlayer autoPlay={false} />
            </Suspense>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* Search and Filters */}
        <div className="flex flex-col lg:flex-row gap-4 mb-8">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <input
              type="text"
              placeholder="Search quizzes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
            />
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap gap-2">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveFilter(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all ${activeFilter === tab.key
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25'
                  : 'bg-gray-800/50 text-gray-400 border border-white/5 hover:bg-gray-700/50 hover:text-white'
                  }`}
              >
                {tab.icon}
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`px-2 py-0.5 rounded-full text-xs ${activeFilter === tab.key
                    ? 'bg-white/20 text-white'
                    : 'bg-gray-700 text-gray-300'
                    }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Quizzes Grid */}
        {loading ? (
          <QuizCardSkeletonGrid count={6} />
        ) : filteredQuizzes.length === 0 ? (
          <div className="text-center py-16">
            <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-3xl border border-white/10 p-12 max-w-md mx-auto">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-purple-500/10 flex items-center justify-center">
                <Search className="w-10 h-10 text-purple-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">No Quizzes Found</h3>
              <p className="text-gray-400 mb-6">
                {searchQuery
                  ? 'Try adjusting your search or filters.'
                  : 'There are no quizzes matching your criteria at the moment.'}
              </p>
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setActiveFilter('all'); }}
                  className="px-6 py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-500 transition-colors"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredQuizzes.map((quiz) => (
              <QuizCard
                key={quiz.id}
                id={quiz.id}
                title={quiz.title}
                description={quiz.description}
                duration={quiz.duration}
                questionCount={quiz.questionCount}
                attemptCount={quiz.attemptCount}
                difficulty="medium"
                status={quiz.isCompleted ? 'completed' : quiz.hasNewQuestions ? 'new' : quiz.status}
                hasAccess={hasAccess}
                isCompleted={quiz.isCompleted}
                score={quiz.score}
                onStartClick={handleQuizClick}
              />
            ))}
          </div>
        )}

        {/* Quiz Detail Modal */}
        {selectedQuiz && (
          <QuizDetailModal
            quiz={{
              ...selectedQuiz,
              difficulty: 'medium',
            }}
            isOpen={!!selectedQuiz}
            onClose={() => setSelectedQuiz(null)}
            onStartQuiz={(quizId) => {
              setSelectedQuiz(null);
              setAttemptQuizId(quizId);
            }}
          />
        )}

        {/* Quiz Attempt Modal */}
        {attemptQuizId && (
          <QuizAttemptModal
            quizId={attemptQuizId}
            isOpen={!!attemptQuizId}
            onClose={() => {
              setAttemptQuizId(null);
              fetchQuizzes();
            }}
            onQuizCompleted={() => {
              fetchQuizzes();
            }}
          />
        )}

        {/* Payment Modal */}
        {showPaymentModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="relative w-full max-w-md bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-white/10 p-8">
              {/* Close button */}
              <button
                onClick={() => setShowPaymentModal(false)}
                className="absolute top-4 right-4 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <span className="text-xl">×</span>
              </button>

              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Get 24-Hour Access</h3>
                <p className="text-gray-400">
                  Unlock unlimited access to all quizzes
                </p>
              </div>

              <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-6 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-gray-300">24-Hour Full Access</span>
                  <span className="text-3xl font-bold text-white">{accessPrice} PKR</span>
                </div>
                <ul className="text-sm text-gray-400 space-y-2">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    Unlimited quiz attempts
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    Access all active quizzes
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    Compete for prizes
                  </li>
                </ul>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowPaymentModal(false)}
                  className="flex-1 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePayNowClick}
                  disabled={paymentLoading}
                  className="flex-1 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {paymentLoading ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Checking...
                    </div>
                  ) : (
                    'Pay Now'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation Modal - Wallet Deduction */}
        {showConfirmationModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="relative w-full max-w-md bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-white/10 p-8">
              {/* Close button */}
              <button
                onClick={() => setShowConfirmationModal(false)}
                className="absolute top-4 right-4 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <span className="text-xl">×</span>
              </button>

              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                  <Wallet className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Confirm Payment</h3>
                <p className="text-gray-400">
                  Deduct from your wallet balance
                </p>
              </div>

              <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl p-6 mb-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Current Balance</span>
                  <span className="text-xl font-bold text-white">{walletBalance.toFixed(2)} PKR</span>
                </div>
                <div className="flex items-center justify-between text-red-400">
                  <span>Amount to Deduct</span>
                  <span className="font-semibold">- {accessPrice.toFixed(2)} PKR</span>
                </div>
                <div className="border-t border-white/10 pt-3 flex items-center justify-between">
                  <span className="text-gray-300">Remaining Balance</span>
                  <span className="text-xl font-bold text-green-400">{(walletBalance - accessPrice).toFixed(2)} PKR</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowConfirmationModal(false);
                    setShowPaymentModal(true);
                  }}
                  className="flex-1 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirmedPayment}
                  disabled={paymentLoading}
                  className="flex-1 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {paymentLoading ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing...
                    </div>
                  ) : (
                    'Confirm Payment'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Insufficient Balance Modal */}
        {showInsufficientBalanceModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="relative w-full max-w-md bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-white/10 p-8">
              {/* Close button */}
              <button
                onClick={() => setShowInsufficientBalanceModal(false)}
                className="absolute top-4 right-4 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <span className="text-xl">×</span>
              </button>

              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Insufficient Balance</h3>
                <p className="text-gray-400">
                  Please add funds to your wallet
                </p>
              </div>

              <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-2xl p-6 mb-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Current Balance</span>
                  <span className="text-xl font-bold text-red-400">{walletBalance.toFixed(2)} PKR</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Required Amount</span>
                  <span className="text-xl font-bold text-white">{accessPrice.toFixed(2)} PKR</span>
                </div>
                <div className="border-t border-white/10 pt-3 flex items-center justify-between">
                  <span className="text-gray-300">Amount Needed</span>
                  <span className="text-xl font-bold text-amber-400">{(accessPrice - walletBalance).toFixed(2)} PKR</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowInsufficientBalanceModal(false)}
                  className="flex-1 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGoToWallet}
                  className="flex-1 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 transition-all flex items-center justify-center gap-2"
                >
                  <Wallet className="w-5 h-5" />
                  Manage Wallet
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}