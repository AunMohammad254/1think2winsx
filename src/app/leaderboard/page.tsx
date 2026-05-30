'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import PodiumSection from './components/PodiumSection';
import LeaderboardRow from './components/LeaderboardRow';
import { Trophy, HelpCircle, Target, Award, Sparkles, ArrowUpRight } from 'lucide-react';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { calculateAccuracy, getUserDisplayName } from '@/utils/quiz';
import {
  staggerContainer,
  fadeInUp,
  scaleIn,
  letterReveal,
  softPulse,
  errorShake,
  slideInError,
  backToTopVariants,
  skeletonShimmer,
  springGentle,
  inViewOptions,
} from './animations';

// Pre-split title characters outside component to prevent array allocation on every render
const TITLE_CHARS = 'Leaderboard'.split('');

function FloatingBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-emerald-900/15 via-slate-900/10 to-transparent" />
      <div className="absolute top-[10%] left-[5%] w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl animate-float-slow will-change-transform opacity-[0.12]" />
      <div className="absolute top-[30%] right-[10%] w-96 h-96 bg-yellow-500/8 rounded-full blur-3xl animate-float-medium will-change-transform opacity-[0.1]" />
      <div className="absolute bottom-[20%] left-[15%] w-64 h-64 bg-blue-500/8 rounded-full blur-3xl animate-float-fast will-change-transform opacity-[0.08]" />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-3xl animate-[spin_25s_linear_infinite]"
        style={{
          background: 'linear-gradient(135deg, rgba(5,150,105,0.06), rgba(59,130,246,0.06))',
        }}
      />
    </>
  );
}

function HeroSection({ lastUpdated }: { lastUpdated: string }) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={springGentle}
      className="bg-slate-800/90 md:backdrop-blur-xl md:bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl text-center"
    >
      <h1 className="text-4xl sm:text-6xl font-bold mb-4 inline-flex flex-wrap justify-center gap-1">
        {TITLE_CHARS.map((char, i) => (
          <motion.span
            key={i}
            className="bg-linear-to-r from-emerald-400 via-teal-300 to-yellow-400 bg-clip-text text-transparent inline-block"
            variants={letterReveal}
            initial="hidden"
            animate="visible"
            custom={i}
            style={char === ' ' ? { width: '0.3em' } : undefined}
          >
            {char === ' ' ? '\u00A0' : char}
          </motion.span>
        ))}
        <motion.span
          className="inline-block"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ ...springGentle, delay: 0.5 }}
        >
          🏆
        </motion.span>
      </h1>
      <motion.p
        className="text-gray-300 text-base sm:text-lg mb-4"
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
      >
        Think Smart, Win Big — dominate the leaderboard
      </motion.p>
      {lastUpdated && (
        <motion.p
          className="text-gray-400 text-xs sm:text-sm"
          variants={fadeInUp}
          initial="hidden"
          animate="visible"
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
}: {
  timeframe: 'weekly' | 'monthly' | 'allTime';
  setTimeframe: (t: 'weekly' | 'monthly' | 'allTime') => void;
}) {
  const [hasHover, setHasHover] = useState(false);

  useEffect(() => {
    setHasHover(window.matchMedia('(hover: hover)').matches);
  }, []);

  const tabs: { key: 'weekly' | 'monthly' | 'allTime'; label: string }[] = [
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'allTime', label: 'All Time' },
  ];

  return (
    <div className="bg-slate-800/90 md:backdrop-blur-xl md:bg-white/5 border border-white/10 rounded-2xl p-1.5 sm:p-2 shadow-xl overflow-hidden relative">
      <div className="grid grid-cols-3 gap-2 relative z-10">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTimeframe(key)}
            className={`relative py-3 rounded-xl font-bold text-xs sm:text-sm uppercase tracking-wider transition-all duration-300 ${
              timeframe === key ? 'text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            {timeframe === key && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-linear-to-r from-emerald-400 to-teal-400 rounded-xl -z-10 shadow-md"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            {timeframe === key && hasHover && (
              <motion.div
                className="absolute inset-0 bg-white/10 rounded-xl -z-10"
                layoutId="tabGlow"
                transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              />
            )}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="bg-slate-800/90 md:backdrop-blur-xl md:bg-white/5 border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
      <div className="p-6 sm:p-8 space-y-6">
        <div className="flex flex-col md:flex-row justify-center items-center md:items-end gap-6 md:gap-4 lg:gap-8 mb-8 w-full max-w-3xl mx-auto">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`bg-slate-900/50 border border-white/5 rounded-3xl p-6 w-full sm:w-[240px] md:w-[200px] lg:w-[230px] space-y-4 animate-pulse ${
                i === 2 ? 'h-80 md:-mt-4' : 'h-72'
              }`}
            >
              <div className="w-16 h-16 rounded-full bg-slate-800 mx-auto" />
              <div className="h-4 bg-slate-800 rounded-sm w-3/4 mx-auto" />
              <div className="h-3 bg-slate-800 rounded-sm w-1/2 mx-auto" />
              <div className="h-10 bg-slate-800 rounded-xl w-full mt-4" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="bg-slate-900/30 border border-white/5 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-center justify-between gap-4 animate-pulse"
            >
              <div className="flex items-center gap-4 w-full md:w-auto">
                <div className="w-8 h-8 rounded-full bg-slate-800" />
                <div className="w-12 h-12 rounded-xl bg-slate-800" />
                <div className="space-y-2 flex-grow min-w-[120px]">
                  <div className="h-4 bg-slate-800 rounded-sm w-3/4" />
                  <div className="h-3 bg-slate-800 rounded-sm w-1/2" />
                </div>
              </div>
              <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end">
                <div className="h-8 bg-slate-800 rounded-lg w-20" />
                <div className="h-8 bg-slate-800 rounded-lg w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const [hasHover, setHasHover] = useState(false);
  const [showRetryGlow, setShowRetryGlow] = useState(false);

  useEffect(() => {
    setHasHover(window.matchMedia('(hover: hover)').matches);
  }, []);

  return (
    <motion.div
      variants={errorShake}
      initial="hidden"
      animate="visible"
      className="flex flex-col items-center justify-center p-8 text-center min-h-[400px] w-full"
    >
      <div className="bg-red-500/10 border border-red-500/30 md:backdrop-blur-xl rounded-3xl p-8 shadow-2xl max-w-md w-full">
        <motion.div
          className="text-5xl mb-4 inline-block"
          animate={{ rotate: [0, -10, 10, -10, 0] }}
          transition={{ duration: 1, repeat: Infinity, repeatDelay: 3 }}
        >
          ⚠️
        </motion.div>
        <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-gray-300 text-sm mb-6 leading-relaxed">{error}</p>
        <div className="relative inline-block w-full">
          <motion.button
            onClick={onRetry}
            onMouseEnter={() => setShowRetryGlow(true)}
            onMouseLeave={() => setShowRetryGlow(false)}
            whileHover={hasHover ? { scale: 1.05, transition: springGentle } : undefined}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3 bg-linear-to-r from-red-500 to-orange-500 text-white font-black rounded-xl shadow-lg shadow-red-500/20 text-sm tracking-wider uppercase transition-colors relative z-10"
          >
            Try Again
          </motion.button>
          {showRetryGlow && hasHover && (
            <motion.div
              layoutId="btnGlow"
              className="absolute inset-0 bg-linear-to-r from-red-500 to-orange-500 rounded-xl blur-md opacity-50"
              transition={springGentle}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center min-h-[400px] w-full animate-fadeIn">
      <div className="bg-slate-800/90 md:backdrop-blur-xl md:bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl max-w-md w-full text-center">
        <div className="text-5xl mb-4 animate-bounce">⚔️</div>
        <h2 className="text-xl font-bold text-white mb-2">No attempts recorded yet</h2>
        <p className="text-gray-400 text-sm mb-6">
          Be the first to participate and secure the top spot on the board!
        </p>
        <Link
          href="/quizzes"
          className="inline-flex items-center px-6 py-3 bg-linear-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black rounded-xl text-sm transition-all duration-300 shadow-lg hover:scale-105"
        >
          Explore Quizzes <ArrowUpRight className="w-4.5 h-4.5 ml-1" />
        </Link>
      </div>
    </div>
  );
}

function CallToAction() {
  const [hasHover, setHasHover] = useState(false);

  useEffect(() => {
    setHasHover(window.matchMedia('(hover: hover)').matches);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={inViewOptions}
      transition={springGentle}
      className="w-full max-w-5xl mx-auto"
    >
      <div className="bg-slate-800/90 md:backdrop-blur-xl md:bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4 text-left">
            <motion.div
              className="w-14 h-14 bg-linear-to-tr from-yellow-400 to-amber-500 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-500/10 shrink-0"
              whileHover={hasHover ? { scale: 1.1, rotate: [0, -10, 10, 0] } : undefined}
            >
              <Trophy className="w-7 h-7 text-slate-950" />
            </motion.div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                Ready to Claim Your Throne?
              </h2>
              <p className="text-gray-300 text-sm sm:text-base mt-1">
                Participate in quizzes, answer correctly, and compete for amazing cash rewards!
              </p>
            </div>
          </div>
          <motion.div whileHover={hasHover ? { scale: 1.04 } : undefined} whileTap={{ scale: 0.98 }} className="shrink-0 w-full md:w-auto">
            <Link
              href="/quizzes"
              className="w-full md:w-auto inline-flex items-center justify-center px-6 py-3.5 bg-linear-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black rounded-xl text-sm transition-all duration-300 shadow-lg shadow-emerald-500/20"
            >
              Play Now <ArrowUpRight className="w-4.5 h-4.5 ml-1" />
            </Link>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

function BackToTop() {
  const [isVisible, setIsVisible] = useState(false);
  const [hasHover, setHasHover] = useState(false);

  useEffect(() => {
    setHasHover(window.matchMedia('(hover: hover)').matches);

    const toggleVisibility = () => {
      if (window.scrollY > 400) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };
    window.addEventListener('scroll', toggleVisibility);
    return () => window.removeEventListener('scroll', toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.button
          variants={backToTopVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={scrollToTop}
          whileHover={hasHover ? { scale: 1.1, boxShadow: '0 0 30px rgba(5,150,105,0.5)' } : undefined}
          whileTap={{ scale: 0.9 }}
          className="fixed bottom-6 right-6 z-40 w-12 h-12 bg-linear-to-tr from-emerald-500 to-teal-500 border border-emerald-400/40 text-slate-950 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 cursor-pointer"
        >
          <motion.span
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            className="text-lg font-bold"
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
  const [timeframe, setTimeframe] = useState<'weekly' | 'monthly' | 'allTime'>('weekly');

  const {
    leaderboard,
    loading,
    error,
    lastUpdated,
    playCounter,
    prevData,
    dataLoaded,
    handleRetry
  } = useLeaderboard(timeframe);

  const userName = useMemo(() => {
    return user ? getUserDisplayName(user) : null;
  }, [user]);

  const currentUserEntry = useMemo(() => {
    return userName ? leaderboard.find((e) => e.userName === userName) : null;
  }, [userName, leaderboard]);

  // Determine if it has been loaded
  const isLoaded = dataLoaded && !loading;

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-emerald-950/20 to-blue-950 text-white relative overflow-x-hidden">
      <FloatingBackground />

      <div className="relative z-10 container mx-auto px-4 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <HeroSection lastUpdated={lastUpdated} />

        <TimeframeTabs timeframe={timeframe} setTimeframe={setTimeframe} />

        <AnimatePresence mode="wait">
          {loading && !dataLoaded ? (
            <motion.div key="loading" exit={{ opacity: 0, transition: { duration: 0.2 } }}>
              <LeaderboardSkeleton />
            </motion.div>
          ) : error ? (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ErrorState error={error} onRetry={handleRetry} />
            </motion.div>
          ) : leaderboard.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyState />
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
                            {calculateAccuracy(currentUserEntry.correctAnswers, currentUserEntry.quizzesTaken)}%
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
                <PodiumSection entries={leaderboard.slice(0, 3)} playCounter={playCounter} />
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
                    prevData={prevData}
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
                  className="bg-slate-800/90 md:backdrop-blur-xl md:bg-white/5 border border-white/10 rounded-3xl p-6 shadow-2xl"
                >
                  <div className="flex items-center gap-4 mb-4">
                    <motion.div
                      className="w-12 h-12 bg-linear-to-r from-emerald-400 to-teal-600 rounded-full flex items-center justify-center animate-pulse"
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
                    className="inline-flex items-center px-6 py-3 bg-linear-to-r from-cyan-500 to-blue-600 text-white rounded-xl transition-all duration-300 shadow-lg touch-manipulation gap-2 hover:scale-105"
                  >
                    🚀 Start playing now
                  </Link>
                </motion.div>
              )}

              <CallToAction />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <BackToTop />
    </div>
  );
}
