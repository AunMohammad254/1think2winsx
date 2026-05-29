'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useInView,
} from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import PodiumSection from './components/PodiumSection';
import LeaderboardRow from './components/LeaderboardRow';
import { Trophy, Target, HelpCircle, Award, Sparkles, ArrowUpRight } from 'lucide-react';
import {
  staggerContainer,
  fadeInUp,
  fadeInDown,
  scaleIn,
  letterReveal,
  floatSlow,
  floatMedium,
  floatFast,
  softPulse,
  errorShake,
  slideInError,
  backToTopVariants,
  skeletonShimmer,
  springGentle,
  inViewOptions,
} from './animations';

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

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function FloatingBackground({ isMobile }: { isMobile: boolean }) {
  const { scrollY } = useScroll();
  const y1 = useTransform(scrollY, [0, 600], [0, 120]);
  const y2 = useTransform(scrollY, [0, 600], [0, -80]);
  const y3 = useTransform(scrollY, [0, 600], [0, 60]);
  const opacity1 = useTransform(scrollY, [0, 400], [0.15, 0.05]);
  const opacity2 = useTransform(scrollY, [0, 400], [0.12, 0.04]);
  const opacity3 = useTransform(scrollY, [0, 400], [0.1, 0.03]);

  if (isMobile) return null;

  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-emerald-900/15 via-slate-900/10 to-transparent" />
      <motion.div style={{ y: y1, opacity: opacity1 }} className="absolute top-[10%] left-[5%] w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" variants={floatSlow} animate="animate" />
      <motion.div style={{ y: y2, opacity: opacity2 }} className="absolute top-[30%] right-[10%] w-96 h-96 bg-yellow-500/8 rounded-full blur-3xl" variants={floatMedium} animate="animate" />
      <motion.div style={{ y: y3, opacity: opacity3 }} className="absolute bottom-[20%] left-[15%] w-64 h-64 bg-blue-500/8 rounded-full blur-3xl" variants={floatFast} animate="animate" />
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-3xl"
        style={{
          background: 'linear-gradient(135deg, rgba(5,150,105,0.06), rgba(59,130,246,0.06))',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
      />
    </>
  );
}

function HeroSection({ lastUpdated, isMobile }: { lastUpdated: string; isMobile: boolean }) {
  const title = 'Leaderboard';
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={springGentle}
      className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl text-center`}
    >
      <h1 className="text-4xl sm:text-6xl font-bold mb-4 inline-flex flex-wrap justify-center gap-1">
        {title.split('').map((char, i) => (
          <motion.span
            key={i}
            className="bg-linear-to-r from-emerald-400 via-teal-300 to-yellow-400 bg-clip-text text-transparent inline-block"
            variants={letterReveal}
            initial="hidden"
            animate={inView ? 'visible' : 'hidden'}
            custom={i}
            style={char === ' ' ? { width: '0.3em' } : undefined}
          >
            {char === ' ' ? '\u00A0' : char}
          </motion.span>
        ))}
        <motion.span
          className="inline-block"
          initial={{ scale: 0, rotate: -180 }}
          animate={inView ? { scale: 1, rotate: 0 } : {}}
          transition={{ ...springGentle, delay: 0.5 }}
        >
          🏆
        </motion.span>
      </h1>
      <motion.p
        className="text-gray-300 text-base sm:text-lg mb-4"
        variants={fadeInUp}
        initial="hidden"
        animate={inView ? 'visible' : 'hidden'}
      >
        Think Smart, Win Big — dominate the leaderboard
      </motion.p>
      {lastUpdated && (
        <motion.p
          className="text-gray-400 text-xs sm:text-sm"
          variants={fadeInUp}
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
        >
          Last updated: {new Date(lastUpdated).toLocaleString()}
        </motion.p>
      )}
    </motion.div>
  );
}

function TimeframeTabs({
  timeframe,
  setTimeframe,
  isMobile,
}: {
  timeframe: string;
  setTimeframe: (t: 'weekly' | 'monthly' | 'allTime') => void;
  isMobile: boolean;
}) {
  const tabs = [
    { key: 'weekly' as const, label: 'Weekly', icon: '📅' },
    { key: 'monthly' as const, label: 'Monthly', icon: '🗓️' },
    { key: 'allTime' as const, label: 'All Time', icon: '⏰' },
  ];

  const containerRef = useRef<HTMLDivElement>(null);
  const [ripples, setRipples] = useState<{ x: number; y: number; id: number }[]>([]);
  const rippleId = useRef(0);

  const handleClick = (key: 'weekly' | 'monthly' | 'allTime', e: React.MouseEvent<HTMLButtonElement>) => {
    setTimeframe(key);
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      const x = e.clientX - containerRect.left;
      const y = e.clientY - containerRect.top;
      const id = rippleId.current++;
      setRipples((prev) => [...prev, { x, y, id }]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 600);
    }
  };

  return (
    <motion.div
      variants={fadeInDown}
      initial="hidden"
      animate="visible"
      className="flex justify-center mb-8 sm:mb-12"
    >
      <div
        ref={containerRef}
        className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-2xl p-1.5 sm:p-2 shadow-xl overflow-hidden relative`}
      >
        <div className="flex gap-1 relative" role="group">
          {tabs.map(({ key, label, icon }) => (
            <button
              key={key}
              type="button"
              className="relative px-3 sm:px-6 py-2 sm:py-3 text-xs sm:text-sm font-medium rounded-xl touch-manipulation outline-none overflow-hidden"
              onClick={(e) => handleClick(key, e)}
            >
              {timeframe === key && (
                <motion.div
                  layoutId="tab-bg"
                  className="absolute inset-0 bg-linear-to-r from-emerald-600 to-teal-500 rounded-xl shadow-lg"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              {timeframe === key && !isMobile && (
                <motion.div
                  className="absolute inset-0 rounded-xl blur-md"
                  style={{ background: 'rgba(5,150,105,0.15)' }}
                  variants={softPulse}
                  animate="animate"
                />
              )}
              {ripples.map((r) => (
                <motion.span
                  key={r.id}
                  className="absolute w-4 h-4 rounded-full bg-white/25 pointer-events-none"
                  style={{ left: r.x - 8, top: r.y - 8 }}
                  initial={{ scale: 0, opacity: 0.4 }}
                  animate={{ scale: 6, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              ))}
              <span className="relative z-10 flex items-center gap-1 sm:gap-2">
                <span>{icon}</span>
                <span className={timeframe === key ? 'text-white' : 'text-gray-300'}>{label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function LeaderboardSkeleton({ isMobile }: { isMobile: boolean }) {
  const rows = 8;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl shadow-2xl overflow-hidden`}
    >
      <div className="p-6 sm:p-8 space-y-6">
        {/* Podium skeletons */}
        <div className="flex justify-center items-end gap-4 sm:gap-6 mb-8">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className={`rounded-3xl ${i === 1 ? 'w-[180px] sm:w-[230px] h-[260px] -mt-4 sm:-mt-8' : 'w-[160px] sm:w-[200px] h-[220px]'}`}
              style={skeletonShimmer}
              animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            />
          ))}
        </div>
        {/* Table skeleton */}
        <div className="space-y-3">
          <div className="h-10 rounded-xl" style={{ ...skeletonShimmer, backgroundPosition: '200% 0' }} />
          {Array.from({ length: rows }).map((_, i) => (
            <motion.div
              key={i}
              className="h-14 rounded-xl"
              style={skeletonShimmer}
              animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear', delay: i * 0.05 }}
            />
          ))}
        </div>
      </div>
      <div className="text-center pb-6">
        <motion.p
          className="text-gray-400 text-sm"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          Loading leaderboard...
        </motion.p>
      </div>
    </motion.div>
  );
}

function ErrorState({ error, isMobile, onRetry }: { error: string; isMobile: boolean; onRetry: () => void }) {
  const [showRetryGlow, setShowRetryGlow] = useState(false);

  return (
    <motion.div
      variants={slideInError}
      initial="hidden"
      animate="visible"
      className="flex justify-center"
    >
      <div className={`${!isMobile ? 'backdrop-blur-xl' : ''} bg-red-500/10 border border-red-500/30 rounded-3xl p-8 shadow-2xl max-w-md w-full`}>
        <motion.div className="text-center" variants={staggerContainer} initial="hidden" animate="visible">
          <motion.div
            className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4"
            variants={errorShake}
            animate="animate"
          >
            <motion.span
              className="text-3xl inline-block"
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              ⚠️
            </motion.span>
          </motion.div>
          <motion.p className="text-red-300 mb-6" variants={fadeInUp}>{error}</motion.p>
          <motion.button
            onClick={onRetry}
            className="px-6 py-3 bg-linear-to-r from-red-500 to-rose-600 text-white rounded-xl transition-all duration-300 shadow-lg touch-manipulation relative outline-none"
            whileHover={!isMobile ? { scale: 1.05, transition: springGentle } : undefined}
            whileTap={{ scale: 0.97 }}
            onHoverStart={() => setShowRetryGlow(true)}
            onHoverEnd={() => setShowRetryGlow(false)}
          >
            <span className="relative z-10 flex items-center gap-2">
              <motion.span
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              >
                🔄
              </motion.span>
              Retry
            </span>
            {showRetryGlow && !isMobile && (
              <motion.div
                className="absolute inset-0 rounded-xl"
                style={{
                  background: 'rgba(239,68,68,0.2)',
                  filter: 'blur(8px)',
                }}
                layoutId="retry-glow"
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </motion.button>
        </motion.div>
      </div>
    </motion.div>
  );
}

function EmptyState({ isMobile }: { isMobile: boolean }) {
  return (
    <motion.div
      variants={scaleIn}
      initial="hidden"
      animate="visible"
      className="flex justify-center"
    >
      <div className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl p-8 shadow-2xl max-w-md w-full text-center`}>
        <motion.div
          className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <span className="text-3xl">📊</span>
        </motion.div>
        <p className="text-gray-300 mb-6">No leaderboard data available for the selected timeframe.</p>
        <Link
          href="/quizzes"
          className="inline-flex items-center px-6 py-3 bg-linear-to-r from-cyan-500 to-blue-600 text-white rounded-xl transition-all duration-300 shadow-lg touch-manipulation"
        >
          🎯 Take a Quiz
        </Link>
      </div>
    </motion.div>
  );
}

function CallToAction({ isMobile }: { isMobile: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 60 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={springGentle}
      className="mt-12 text-center"
    >
      <div className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl`}>
        <motion.div
          className="flex items-center justify-center mb-6"
          whileHover={!isMobile ? { scale: 1.1, rotate: [0, -10, 10, 0] } : undefined}
        >
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-linear-to-r from-cyan-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
            <span className="text-2xl sm:text-3xl">🎯</span>
          </div>
        </motion.div>
        <h3 className="text-xl sm:text-2xl font-bold bg-linear-to-r from-yellow-300 via-orange-300 to-red-400 bg-clip-text text-transparent mb-4">
          Want to climb the leaderboard?
        </h3>
        <p className="text-gray-300 mb-6">Challenge yourself with our exciting quizzes and compete with players worldwide!</p>
        <motion.div whileHover={!isMobile ? { scale: 1.04 } : undefined} whileTap={{ scale: 0.98 }}>
          <Link
            href="/quizzes"
            className="inline-flex items-center px-6 sm:px-8 py-3 sm:py-4 bg-linear-to-r from-cyan-500 to-blue-600 text-white text-base sm:text-lg font-bold rounded-2xl transition-all duration-300 shadow-2xl touch-manipulation gap-2 sm:gap-3"
          >
            <span>🎮</span>
            Play Quizzes Now
            <motion.span
              animate={{ x: [0, 4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              🚀
            </motion.span>
          </Link>
        </motion.div>
      </div>
    </motion.div>
  );
}

function BackToTop({ isMobile }: { isMobile: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          variants={backToTopVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-linear-to-r from-emerald-500 to-teal-600 text-white shadow-2xl flex items-center justify-center touch-manipulation outline-none"
          whileHover={!isMobile ? { scale: 1.1, boxShadow: '0 0 30px rgba(5,150,105,0.5)' } : undefined}
          whileTap={{ scale: 0.9 }}
        >
          <motion.span
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            className="text-lg"
          >
            ↑
          </motion.span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<'weekly' | 'monthly' | 'allTime'>('weekly');
  const [lastUpdated, setLastUpdated] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [playCounter, setPlayCounter] = useState(false);
  const prevDataRef = useRef<Map<string, { rank: number; score: number }>>(new Map());
  const dataLoadedRef = useRef(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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
    const interval = setInterval(() => fetchLeaderboard(false), 30000);
    return () => clearInterval(interval);
  }, [fetchLeaderboard]);

  useEffect(() => {
    if (playCounter) {
      const timer = setTimeout(() => setPlayCounter(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [playCounter]);

  const handleRetry = () => {
    setError(null);
    setLoading(true);
    fetchLeaderboard(true);
  };

  const userName = user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0];
  const currentUserEntry = userName ? leaderboard.find((e) => e.userName === userName) : null;

  const debouncedLoading = useDebounce(loading, 200);

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-emerald-950/20 to-blue-950 text-white relative overflow-x-hidden">
      <FloatingBackground isMobile={isMobile} />

      <div className="relative z-10 container mx-auto px-4 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <HeroSection lastUpdated={lastUpdated} isMobile={isMobile} />

        <TimeframeTabs timeframe={timeframe} setTimeframe={setTimeframe} isMobile={isMobile} />

        <AnimatePresence mode="wait">
          {debouncedLoading && !dataLoadedRef.current ? (
            <motion.div key="loading" exit={{ opacity: 0, transition: { duration: 0.2 } }}>
              <LeaderboardSkeleton isMobile={isMobile} />
            </motion.div>
          ) : error ? (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ErrorState error={error} isMobile={isMobile} onRetry={handleRetry} />
            </motion.div>
          ) : leaderboard.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyState isMobile={isMobile} />
            </motion.div>
          ) : (
            <motion.div
              key="content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-6 sm:space-y-8"
            >
              {/* Personal Player Status Dashboard */}
              {user && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={springGentle}
                  className="w-full max-w-5xl mx-auto animate-fadeIn"
                >
                  {currentUserEntry ? (
                    <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-teal-950/40 border border-emerald-500/30 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                      <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
                      <div className="absolute -left-10 -top-10 w-40 h-40 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />
                      
                      <div className="flex items-center gap-4 w-full md:w-auto relative z-10">
                        <div className="w-14 h-14 bg-gradient-to-tr from-emerald-500 to-teal-500 rounded-2xl flex items-center justify-center font-black text-white shadow-lg text-lg">
                          {currentUserEntry.userName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                            {currentUserEntry.userName} <Sparkles className="w-4 h-4 text-yellow-400 animate-pulse" />
                          </h2>
                          <p className="text-slate-400 text-xs sm:text-sm font-medium mt-0.5">
                            Your current position on the board
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 sm:gap-4 w-full md:w-auto text-center md:text-left relative z-10">
                        <div className="bg-white/5 border border-white/5 rounded-2xl p-3">
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1 flex items-center gap-1 justify-center md:justify-start">
                            <Trophy className="w-3 h-3 text-yellow-400" /> Rank
                          </span>
                          <span className="text-lg sm:text-xl font-black text-white">
                            #{currentUserEntry.rank}
                          </span>
                        </div>
                        
                        <div className="bg-white/5 border border-white/5 rounded-2xl p-3">
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1 flex items-center gap-1 justify-center md:justify-start">
                            <HelpCircle className="w-3 h-3 text-blue-400" /> Plays
                          </span>
                          <span className="text-lg sm:text-xl font-black text-white">
                            {currentUserEntry.quizzesTaken}
                          </span>
                        </div>

                        <div className="bg-white/5 border border-white/5 rounded-2xl p-3">
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1 flex items-center gap-1 justify-center md:justify-start">
                            <Target className="w-3 h-3 text-emerald-400" /> Accuracy
                          </span>
                          <span className="text-lg sm:text-xl font-black text-emerald-400">
                            {currentUserEntry.quizzesTaken > 0 ? Math.round((currentUserEntry.correctAnswers / (currentUserEntry.quizzesTaken * 10)) * 100) : 0}%
                          </span>
                        </div>

                        <div className="bg-white/5 border border-white/5 rounded-2xl p-3">
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1 flex items-center gap-1 justify-center md:justify-start">
                            <Award className="w-3 h-3 text-teal-400" /> Score
                          </span>
                          <span className="text-lg sm:text-xl font-black text-white">
                            {currentUserEntry.totalScore}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gradient-to-r from-slate-900/80 to-slate-950/80 border border-white/10 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                      <div className="flex items-center gap-4 relative z-10">
                        <div className="w-14 h-14 bg-slate-800 border border-white/10 rounded-2xl flex items-center justify-center font-black text-slate-400 shadow-md text-lg">
                          ?
                        </div>
                        <div>
                          <h2 className="text-base sm:text-lg font-black text-white">
                            You are not ranked yet
                          </h2>
                          <p className="text-slate-400 text-xs sm:text-sm mt-0.5">
                            Participate in any active quiz to qualify for the {timeframe} leaderboard!
                          </p>
                        </div>
                      </div>
                      <Link
                        href="/quizzes"
                        className="px-5 py-3 bg-linear-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black rounded-xl text-sm transition-all duration-300 shadow-lg flex items-center gap-1.5 shrink-0 hover:scale-105"
                      >
                        Start Quiz <ArrowUpRight className="w-4 h-4" />
                      </Link>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Podium */}
              <motion.div variants={fadeInUp} initial="hidden" animate="visible">
                <PodiumSection entries={leaderboard.slice(0, 3)} isMobile={isMobile} playCounter={playCounter} />
              </motion.div>

              {/* Leaderboard Stack */}
              <motion.div
                variants={fadeInUp}
                initial="hidden"
                animate="visible"
                className="space-y-3 w-full max-w-5xl mx-auto"
              >
                {leaderboard.map((entry, index) => (
                  <LeaderboardRow
                    key={`${entry.id}-${entry.rank}`}
                    entry={entry}
                    index={index}
                    isCurrentUser={entry.userName === userName}
                    prevData={prevDataRef.current}
                    isMobile={isMobile}
                    playCounter={playCounter}
                  />
                ))}
              </motion.div>

              {/* User position CTA */}
              {user && !currentUserEntry && (
                <motion.div
                  variants={fadeInUp}
                  initial="hidden"
                  whileInView="visible"
                  viewport={inViewOptions}
                  className={`${!isMobile ? 'backdrop-blur-xl bg-white/5' : 'bg-slate-800/90'} border border-white/10 rounded-3xl p-6 shadow-2xl`}
                >
                  <div className="flex items-center gap-4 mb-4">
                    <motion.div
                      className="w-12 h-12 bg-linear-to-r from-emerald-400 to-teal-600 rounded-full flex items-center justify-center"
                      whileHover={!isMobile ? { rotate: 15, scale: 1.1 } : undefined}
                    >
                      <span className="text-2xl">📍</span>
                    </motion.div>
                    <h3 className="text-lg sm:text-xl font-bold text-white">Your Position</h3>
                  </div>
                  <p className="text-gray-300 mb-4">
                    You haven&apos;t participated in any quizzes yet or don&apos;t appear in the top rankings for this timeframe.
                  </p>
                  <Link
                    href="/quizzes"
                    className="inline-flex items-center px-6 py-3 bg-linear-to-r from-cyan-500 to-blue-600 text-white rounded-xl transition-all duration-300 shadow-lg touch-manipulation gap-2"
                  >
                    🚀 Start playing now
                  </Link>
                </motion.div>
              )}

              <CallToAction isMobile={isMobile} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <BackToTop isMobile={isMobile} />
    </div>
  );
}
