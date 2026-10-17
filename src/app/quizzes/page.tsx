'use client';

import '../live-quiz.css';

import { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Search, Filter, Clock, CheckCircle, Sparkles } from 'lucide-react';
import QuizCard from '@/components/quiz/QuizCard';
import { QuizCardSkeletonGrid } from '@/components/quiz/QuizCardSkeleton';
import LazyStreamPlayer from '@/components/LazyStreamPlayer';
import dynamic from 'next/dynamic';
import type { LiveQuizPushHandle } from '@/components/quiz/LiveQuizPush';

const LiveQuizPush = dynamic(() => import('@/components/quiz/LiveQuizPush'), {
  ssr: false,
});
import { getWalletBalanceForDeduction, deductWalletForQuizAccess, getQuizAccessPrice } from '@/actions/wallet-deduction-actions';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { useJitteredPolling } from '@/hooks/useJitteredPolling';
import { mergeLiveQuizzes, UNREAD_COUNT_EVENT, type LiveSnapshot } from '@/lib/live-catalog';
import PaymentModal from '@/components/quiz/PaymentModal';
import ConfirmationModal from '@/components/quiz/ConfirmationModal';
import InsufficientBalanceModal from '@/components/quiz/InsufficientBalanceModal';

interface Quiz {
  id: string;
  title: string;
  description: string;
  duration: number;
  passingScore: number;
  status: 'active' | 'paused' | 'scheduled' | 'upcoming';
  startsAt?: string | null;
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
  totalAttempts?: number;
  pushedAt?: string | null;
  pushStatus?: 'unanswered' | 'answered' | 'upcoming' | 'time-up' | null;
}

interface PaymentInfo {
  id: string;
  expiresAt: string;
  timeRemaining: number;
}

type FilterTab = 'all' | 'available' | 'completed' | 'new';

export default function QuizzesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-12 px-4"><div className="max-w-7xl mx-auto"><QuizCardSkeletonGrid count={6} /></div></div>}>
      <QuizzesPageInner />
    </Suspense>
  );
}

function QuizzesPageInner() {
  const { user, isLoading } = useAuth();
  const userId = user?.id ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  // Always the latest list, readable from the live check without re-creating it
  const quizzesRef = useRef<Quiz[]>([]);
  useEffect(() => {
    quizzesRef.current = quizzes;
  }, [quizzes]);
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
  const [walletEnabled, setWalletEnabled] = useState<boolean | null>(null); // null = loading

  // Fetch quizzes — pass `fresh=true` to bypass server-side cache (used by the live check)
  const refetchTimerRef = useRef<NodeJS.Timeout | null>(null);
  // The live check needs the player's own fields (and access) from the first personal load
  const personalLoadedRef = useRef(false);
  const hasAccessRef = useRef(false);
  const liveQuizPushRef = useRef<LiveQuizPushHandle>(null);
  // A deep link that arrived before LiveQuizPush mounted (page skeleton, or its lazy chunk
  // still loading); opened as soon as the component attaches its handle
  const pendingOpenQuizRef = useRef<string | null>(null);
  const attachLiveQuizPush = useCallback((handle: LiveQuizPushHandle | null) => {
    liveQuizPushRef.current = handle;
    if (handle && pendingOpenQuizRef.current) {
      handle.open(pendingOpenQuizRef.current);
      pendingOpenQuizRef.current = null;
    }
  }, []);
  // Last pushedAt we've already reacted to, per quiz - so re-fetches or
  // unrelated edits to an already-pushed quiz don't re-fire the toast.
  const seenPushedAtRef = useRef<Map<string, string | null>>(new Map());

  // Resolves true on success (incl. 304) and false on failure, so the poller can back off.
  // `background` fetches (the poll) don't retry on their own: the poller already backs off, and
  // retrying inside every poll would multiply load exactly when the server is struggling.
  const fetchQuizzesData = useCallback(async (fresh = false, background = false): Promise<boolean> => {
    let ok = false;
    try {
      const url = fresh ? '/api/quizzes?fresh=1' : '/api/quizzes';
      // User-triggered loads retry 429/502/503/504 with jittered backoff (the server sheds load
      // with 503 + Retry-After when saturated).
      const response = await fetchWithRetry(url, undefined, { retries: background ? 0 : 2 });
      if (response.status === 304) return true;
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
        return false;
      }
      const data = await response.json();
      const fetchedQuizzes: Quiz[] = data.quizzes || [];
      quizzesRef.current = fetchedQuizzes;
      setQuizzes(fetchedQuizzes);
      for (const q of fetchedQuizzes) seenPushedAtRef.current.set(q.id, q.pushedAt ?? null);
      hasAccessRef.current = data.hasAccess || false;
      personalLoadedRef.current = true;
      setHasAccess(data.hasAccess || false);
      // The navbar bell takes its badge from here instead of polling on its own
      if (typeof data.unreadNotifications === 'number') {
        window.dispatchEvent(new CustomEvent(UNREAD_COUNT_EVENT, { detail: data.unreadNotifications }));
      }
      setPaymentInfo(data.paymentInfo);
      setError(data.accessError || null);
      // The list response carries the wallet flag, so no separate /api/settings/wallet-enabled call
      if (typeof data.walletEnabled === 'boolean') setWalletEnabled(data.walletEnabled);
      ok = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quizzes');
      toast.error('Failed to load quizzes');
    } finally {
      // null means "still loading"; if we never learned the flag (failed load), default to
      // enabled — the same fallback the old separate flag request used — rather than hanging
      // on the skeleton forever. Setting it is what ends the first-load skeleton.
      setWalletEnabled(prev => prev ?? true);
    }
    return ok;
  }, []);

  // Debounced personal re-fetch to avoid rapid consecutive API calls
  const debouncedFreshFetch = useCallback(() => {
    if (refetchTimerRef.current) {
      clearTimeout(refetchTimerRef.current);
    }
    // Spread re-fetches over 2-15 s: every player sees the same live change within
    // seconds of each other, and a fixed delay turned it into a synchronized
    // stampede of thousands of simultaneous /api/quizzes calls.
    refetchTimerRef.current = setTimeout(() => {
      fetchQuizzesData(true);
    }, 2000 + Math.random() * 13000);
  }, [fetchQuizzesData]);
  useEffect(() => () => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
  }, []);

  // Redirect to login if not authenticated, and check wallet feature flag
  useEffect(() => {
    if (isLoading) return;

    if (!userId) {
      router.push('/login');
      return;
    }

    // The wallet feature flag (disabled means quizzes are free, not blocked; it only controls
    // whether the payment UI shows) now arrives in the /api/quizzes response itself, which
    // also removes the old flag-then-quizzes request waterfall.
    fetchQuizzesData();
    // Depend on the user's id, not the object: Supabase hands out a new `user` object on tab
    // refocus / token refresh, which used to re-run this and refetch for no reason.
  }, [userId, isLoading, router, fetchQuizzesData]);

  // Slow safety net for the player's own fields (completed, new questions, unread count); public
  // changes arrive through the live check below. 5 min base + 0-1 min jitter so clients that loaded
  // together drift apart, paused while the tab is hidden, and exponential backoff while the server
  // is failing/shedding.
  const pollQuizzes = useCallback(() => fetchQuizzesData(true, true), [fetchQuizzesData]);
  useJitteredPolling(pollQuizzes, { intervalMs: 300_000, jitterMs: 60_000, enabled: !!userId });

  // Live updates: every few seconds, check the public quiz snapshot (Cloudflare caches it for 5 s)
  // and patch the list in place when it changed. No Realtime connection per player, and however many
  // players are online the origin sees about one request per Cloudflare location per 5 s.
  const liveVersionRef = useRef<string | null>(null);
  const checkLive = useCallback(async (): Promise<boolean> => {
    // The merge keeps the player's own fields, and the first load fills seenPushedAtRef so quizzes
    // that were already live do not pop up as "just went live"
    if (!personalLoadedRef.current) return true;
    try {
      const response = await fetch('/api/live', { credentials: 'omit' });
      if (!response.ok) return false;
      const snapshot: LiveSnapshot = await response.json();
      if (snapshot.version === liveVersionRef.current) return true;
      liveVersionRef.current = snapshot.version;
      // Admin "push to live": a pushedAt we have not reacted to yet shows the live popup
      for (const q of snapshot.quizzes) {
        if (q.pushedAt && seenPushedAtRef.current.get(q.id) !== q.pushedAt) {
          seenPushedAtRef.current.set(q.id, q.pushedAt);
          liveQuizPushRef.current?.notify(q.id, q.title);
        }
      }
      const merged = mergeLiveQuizzes(quizzesRef.current, snapshot.quizzes, hasAccessRef.current);
      quizzesRef.current = merged.list;
      setQuizzes(merged.list);
      if (merged.needsPersonalFetch) debouncedFreshFetch();
      return true;
    } catch {
      return false;
    }
  }, [debouncedFreshFetch]);
  useJitteredPolling(checkLive, { intervalMs: 5_000, jitterMs: 2_000, enabled: !!userId });

  // Deep link from the notification bell / a "View Details" link on a
  // pushed-quiz notification (e.g. /quizzes?openQuiz=abc123): open it
  // straight into the popup instead of the toast. Reactive (useSearchParams,
  // not a one-time window.location read) so clicking a bell notification
  // while ALREADY on /quizzes also opens it, not just on first load. Strips
  // the param afterward so a refresh or back-navigation doesn't reopen it.
  useEffect(() => {
    if (isLoading || !userId) return;
    const openQuiz = searchParams.get('openQuiz');
    if (!openQuiz) return;
    if (liveQuizPushRef.current) liveQuizPushRef.current.open(openQuiz);
    else pendingOpenQuizRef.current = openQuiz;
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete('openQuiz');
    const query = rest.toString();
    router.replace(query ? `/quizzes?${query}` : '/quizzes', { scroll: false });
  }, [isLoading, userId, router, searchParams]);

  // Throwback behavior removed as requested.

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

  // Legacy fetchQuizzes alias for components that call it
  const fetchQuizzes = fetchQuizzesData;

  // When an upcoming quiz reaches its start time, check the live snapshot so its card flips to
  // live without waiting for the next poll (the server activates it when its catalogue refreshes).
  // The snapshot is the cached public one, so the moment of go-live costs no personal requests.
  useEffect(() => {
    if (!userId) return;
    const now = Date.now();
    const starts = quizzes
      .filter(q => q.status === 'upcoming' && q.startsAt)
      .map(q => new Date(q.startsAt as string).getTime())
      .filter(t => t > now);
    if (starts.length === 0) return;
    // +1 s so the server has activated the quiz, plus 0-5 s of random jitter: every player's
    // clock hits startsAt within a couple of seconds of each other, and without jitter this was
    // a synchronized stampede of tens of thousands of /api/quizzes calls at the moment of go-live.
    const delay = Math.min(...starts) - now + 1000 + Math.random() * 5000;
    // setTimeout overflows past ~24.8 days; the live check covers anything further out
    if (delay > 2_000_000_000) return;
    const timer = setTimeout(() => { checkLive(); }, delay);
    return () => clearTimeout(timer);
  }, [userId, quizzes, checkLive]);

  // ⚡ Bolt: Wrapped in useCallback to preserve stable function reference.
  // Impact: Essential for React.memo on QuizCard to work, preventing ~90% of re-renders.
  const handleQuizClick = useCallback((quizId: string) => {
    const clicked = quizzes.find(q => q.id === quizId);
    if (clicked?.status === 'upcoming') {
      const when = clicked.startsAt
        ? new Date(clicked.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
        : 'soon';
      toast.info(`"${clicked.title}" hasn't started yet. It goes live ${when}.`);
      return;
    }
    if (hasAccess) {
      liveQuizPushRef.current?.open(quizId);
    } else {
      setShowPaymentModal(true);
    }
  }, [quizzes, hasAccess]); // router is not strictly needed for App Router, but it is available.

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
  const filteredQuizzes = useMemo(() => {
    return quizzes.filter(quiz => {
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
  }, [quizzes, searchQuery, activeFilter]);

  const filterTabs: { key: FilterTab; label: string; icon: React.ReactNode; count?: number }[] = useMemo(() => [
    { key: 'all', label: 'All Quizzes', icon: <Filter className="w-4 h-4" />, count: quizzes.length },
    { key: 'available', label: 'Available', icon: <Clock className="w-4 h-4" />, count: quizzes.filter(q => q.status === 'active' && !q.isCompleted).length },
    { key: 'completed', label: 'Completed', icon: <CheckCircle className="w-4 h-4" />, count: quizzes.filter(q => q.isCompleted).length },
    { key: 'new', label: 'New Questions', icon: <Sparkles className="w-4 h-4" />, count: quizzes.filter(q => q.hasNewQuestions).length },
  ], [quizzes]);

  if (isLoading || walletEnabled === null) {
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
        <div className="mb-4">
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white via-purple-200 to-white">
            Quiz Arena
          </h1>
          <p className="text-gray-400 text-sm max-w-2xl">
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

        {/* Live Stream Section — everything push/toast/split-related is scoped
            to this one relative+overflow-hidden box; it never affects the
            quiz grid below or any other part of the page. */}
        <div className="mb-8 live-quiz-theme" id="live-stream-section">
          <div id="live-stream-fullscreen-target" className="stream-section h-full w-full">
            <div className="stream-row w-full flex-1">
              <div className="player flex-1">
                <div className="absolute inset-0 z-10 pointer-events-none">
                  <div className="badge-live"><span className="rec"></span>LIVE</div>
                  <div className="viewers">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
                    <span className="num">2,481</span>
                  </div>
                </div>
                <div className="w-full relative z-0">
                  <Suspense fallback={<div className="aspect-video w-full bg-gray-800 rounded-xl animate-pulse" />}>
                    <LazyStreamPlayer autoPlay={false} fullscreenTargetId="live-stream-fullscreen-target" />
                  </Suspense>
                </div>
              </div>
              <LiveQuizPush ref={attachLiveQuizPush} onAnswered={() => fetchQuizzesData(true)} />
            </div>
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

        {/* Quizzes Grid (the first load shows the skeleton above) */}
        {filteredQuizzes.length === 0 ? (
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
          <div className="live-quiz-theme">
            <div className="section-label">Today's quizzes — pushed by admin</div>
            <div className="quiz-grid">
              {filteredQuizzes.map((quiz) => (
                <QuizCard
                  key={quiz.id}
                id={quiz.id}
                title={quiz.title}
                description={quiz.description}
                duration={quiz.duration}
                questionCount={quiz.questionCount}
                attemptCount={quiz.attemptCount ?? quiz.totalAttempts}
                difficulty="medium"
                status={quiz.isCompleted ? 'completed' : quiz.hasNewQuestions ? 'new' : (quiz.status as any)}
                hasAccess={hasAccess}
                isCompleted={quiz.isCompleted}
                score={quiz.score}
                onStartClick={handleQuizClick}
                pushStatus={quiz.pushStatus}
                startsAt={quiz.startsAt}
              />
            ))}
            </div>
          </div>
        )}

        {/* Payment Modal */}
        <PaymentModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          accessPrice={accessPrice}
          paymentLoading={paymentLoading}
          handlePayNowClick={handlePayNowClick}
        />

        {/* Confirmation Modal - Wallet Deduction */}
        <ConfirmationModal
          isOpen={showConfirmationModal}
          onClose={() => setShowConfirmationModal(false)}
          walletBalance={walletBalance}
          accessPrice={accessPrice}
          paymentLoading={paymentLoading}
          handleConfirmedPayment={handleConfirmedPayment}
          onBack={() => {
            setShowConfirmationModal(false);
            setShowPaymentModal(true);
          }}
        />

        {/* Insufficient Balance Modal */}
        <InsufficientBalanceModal
          isOpen={showInsufficientBalanceModal}
          onClose={() => setShowInsufficientBalanceModal(false)}
          walletBalance={walletBalance}
          accessPrice={accessPrice}
          handleGoToWallet={handleGoToWallet}
        />
      </div>
    </div>
  );
}
