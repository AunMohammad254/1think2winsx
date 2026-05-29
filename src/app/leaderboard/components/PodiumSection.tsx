'use client';

import { useRef, useEffect } from 'react';
import { motion, useInView, animate } from 'framer-motion';
import { podiumCardVariants, springGentle, getRankGlow } from '../animations';
import { Trophy, HelpCircle, Award } from 'lucide-react';

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

function AnimatedScore({ value, play }: { value: number; play: boolean }) {
  const nodeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!play || !nodeRef.current) return;
    const from = parseInt(nodeRef.current.textContent || '0', 10);
    const controls = animate(from, value, {
      duration: 0.7,
      ease: 'easeOut',
      onUpdate: (latest) => {
        if (nodeRef.current) nodeRef.current.textContent = Math.round(latest).toString();
      },
    });
    return controls.stop;
  }, [value, play]);

  return <span ref={nodeRef}>{value}</span>;
}

function ShimmerOverlay() {
  return (
    <motion.div
      className="absolute inset-0 rounded-full overflow-hidden pointer-events-none"
      initial={false}
    >
      <motion.div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
        }}
        animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
      />
    </motion.div>
  );
}

function CrownIcon() {
  return (
    <motion.span
      className="text-4xl inline-block drop-shadow-[0_0_10px_rgba(234,179,8,0.6)]"
      animate={{ 
        rotate: [0, 8, -8, 0],
        scale: [1, 1.1, 0.95, 1]
      }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
    >
      👑
    </motion.span>
  );
}

function MedalIcon({ type }: { type: 'silver' | 'bronze' }) {
  return (
    <div className="relative">
      <span className="text-3xl filter drop-shadow-md">
        {type === 'silver' ? '🥈' : '🥉'}
      </span>
      <ShimmerOverlay />
    </div>
  );
}

export default function PodiumSection({
  entries,
  isMobile,
  playCounter,
}: {
  entries: LeaderboardEntry[];
  isMobile: boolean;
  playCounter: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-50px' });

  if (entries.length < 3) return null;

  const [first, second, third] = entries;

  // Accuracy calculations
  const secondAccuracy = second.quizzesTaken > 0 ? Math.round((second.correctAnswers / (second.quizzesTaken * 10)) * 100) : 0;
  const firstAccuracy = first.quizzesTaken > 0 ? Math.round((first.correctAnswers / (first.quizzesTaken * 10)) * 100) : 0;
  const thirdAccuracy = third.quizzesTaken > 0 ? Math.round((third.correctAnswers / (third.quizzesTaken * 10)) * 100) : 0;

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      className="flex flex-col md:flex-row justify-center items-center md:items-end gap-6 md:gap-4 lg:gap-8 mb-12 w-full max-w-5xl mx-auto px-4"
    >
      {/* 2nd Place: Silver Collector Card */}
      <motion.div
        variants={podiumCardVariants}
        custom={0}
        whileHover={
          !isMobile
            ? {
                y: -12,
                boxShadow: '0 20px 40px rgba(156,163,175,0.2)',
                transition: springGentle,
              }
            : undefined
        }
        className="relative backdrop-blur-2xl bg-linear-to-b from-slate-900/90 via-slate-900/60 to-slate-950/90 border border-slate-700/40 rounded-3xl p-6 shadow-2xl w-full sm:w-[280px] md:w-[210px] lg:w-[250px] order-2 md:order-1"
      >
        <div className="absolute top-0 right-0 transform translate-x-1 -translate-y-1 bg-slate-700/80 border border-slate-500/30 text-[10px] font-bold uppercase tracking-wider text-slate-300 px-3 py-1 rounded-full shadow-md z-10">
          Rank #2
        </div>
        
        <div className="text-center">
          {/* Avatar Ring */}
          <div className="relative w-18 h-18 sm:w-20 sm:h-20 mx-auto mb-4">
            <motion.div
              className="w-full h-full rounded-full bg-linear-to-r from-gray-300 to-gray-500 flex items-center justify-center shadow-lg border-2 border-gray-400"
              style={{ boxShadow: getRankGlow(2) }}
            >
              <MedalIcon type="silver" />
            </motion.div>
          </div>
          
          <h3 className="text-lg sm:text-xl font-extrabold text-white truncate max-w-[150px] md:max-w-[130px] lg:max-w-[200px] mx-auto">
            {second.userName}
          </h3>
          
          <p className="text-gray-400 text-xs mt-1 font-semibold flex items-center justify-center gap-1">
            <Trophy className="w-3.5 h-3.5 text-slate-400" />
            Wins: <span className="text-white font-bold">{second.winCount}</span>
          </p>

          <div className="border-t border-white/5 my-4" />

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-2 text-left text-xs mb-4">
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-wider mb-0.5">Quizzes</span>
              <span className="font-bold text-white flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5 text-blue-400" /> {second.quizzesTaken}
              </span>
            </div>
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-wider mb-0.5">Accuracy</span>
              <span className="font-bold text-teal-400 flex items-center gap-1">
                <Award className="w-3.5 h-3.5 text-teal-400" /> {secondAccuracy}%
              </span>
            </div>
          </div>

          {/* Premium Score Section */}
          <div className="bg-linear-to-r from-slate-800 to-slate-900 border border-slate-700/50 rounded-2xl px-4 py-3 flex items-center justify-between shadow-md">
            <span className="text-[10px] text-slate-400 uppercase font-extrabold tracking-wider">Score</span>
            <span className="text-white font-black text-lg">
              <AnimatedScore value={second.totalScore} play={playCounter && inView} /> <span className="text-xs text-slate-400">PTS</span>
            </span>
          </div>
        </div>
      </motion.div>

      {/* 1st Place: Gold Champion Card */}
      <motion.div
        variants={podiumCardVariants}
        custom={1}
        whileHover={
          !isMobile
            ? {
                y: -16,
                boxShadow: '0 25px 50px rgba(234,179,8,0.25)',
                transition: springGentle,
              }
            : undefined
        }
        className="relative backdrop-blur-2xl bg-linear-to-b from-slate-900/90 via-slate-900/60 to-slate-950/90 border border-yellow-500/40 rounded-3xl p-6 md:p-6 lg:p-8 shadow-2xl w-full sm:w-[300px] md:w-[230px] lg:w-[270px] md:-mt-6 order-1 md:order-2 border-t-2"
        style={{
          boxShadow: '0 0 35px -5px rgba(234,179,8,0.15)',
        }}
      >
        <div className="absolute top-0 right-0 transform translate-x-1 -translate-y-1 bg-yellow-500 text-[10px] font-bold uppercase tracking-wider text-slate-950 px-3 py-1 rounded-full shadow-md z-10 animate-pulse">
          Champion
        </div>

        <div className="text-center">
          {/* Avatar Ring */}
          <motion.div
            className="relative w-20 h-20 sm:w-24 sm:h-24 mx-auto mb-4"
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <motion.div
              className="w-full h-full rounded-full bg-linear-to-r from-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg border-3 border-yellow-400"
              style={{ boxShadow: getRankGlow(1) }}
              animate={{ 
                boxShadow: [
                  '0 0 20px rgba(234,179,8,0.4)',
                  '0 0 45px rgba(234,179,8,0.7)',
                  '0 0 20px rgba(234,179,8,0.4)',
                ] 
              }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <CrownIcon />
            </motion.div>
          </motion.div>
          
          <h3 className="text-xl sm:text-2xl font-black bg-linear-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent truncate max-w-[170px] md:max-w-[150px] lg:max-w-[220px] mx-auto">
            {first.userName}
          </h3>
          
          <p className="text-yellow-400 text-xs mt-1 font-semibold flex items-center justify-center gap-1">
            <Trophy className="w-3.5 h-3.5 text-yellow-400" />
            Wins: <span className="text-white font-extrabold">{first.winCount}</span>
          </p>

          <div className="border-t border-white/5 my-4" />

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-2 text-left text-xs mb-4">
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-wider mb-0.5">Quizzes</span>
              <span className="font-bold text-white flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5 text-blue-400" /> {first.quizzesTaken}
              </span>
            </div>
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-wider mb-0.5">Accuracy</span>
              <span className="font-bold text-teal-400 flex items-center gap-1">
                <Award className="w-3.5 h-3.5 text-teal-400" /> {firstAccuracy}%
              </span>
            </div>
          </div>

          {/* Premium Score Section */}
          <div className="bg-linear-to-r from-yellow-500/10 to-yellow-600/10 border border-yellow-500/30 rounded-2xl px-4 py-3 flex items-center justify-between shadow-md">
            <span className="text-[10px] text-yellow-400 uppercase font-extrabold tracking-wider">Score</span>
            <span className="text-white font-black text-lg">
              <AnimatedScore value={first.totalScore} play={playCounter && inView} /> <span className="text-xs text-yellow-400">PTS</span>
            </span>
          </div>
        </div>
      </motion.div>

      {/* 3rd Place: Bronze Collector Card */}
      <motion.div
        variants={podiumCardVariants}
        custom={2}
        whileHover={
          !isMobile
            ? {
                y: -10,
                boxShadow: '0 20px 40px rgba(217,119,6,0.2)',
                transition: springGentle,
              }
            : undefined
        }
        className="relative backdrop-blur-2xl bg-linear-to-b from-slate-900/90 via-slate-900/60 to-slate-950/90 border border-slate-700/40 rounded-3xl p-6 shadow-2xl w-full sm:w-[280px] md:w-[210px] lg:w-[250px] order-3"
      >
        <div className="absolute top-0 right-0 transform translate-x-1 -translate-y-1 bg-amber-700/80 border border-amber-500/30 text-[10px] font-bold uppercase tracking-wider text-amber-300 px-3 py-1 rounded-full shadow-md z-10">
          Rank #3
        </div>

        <div className="text-center">
          {/* Avatar Ring */}
          <div className="relative w-18 h-18 sm:w-20 sm:h-20 mx-auto mb-4">
            <motion.div
              className="w-full h-full rounded-full bg-linear-to-r from-amber-400 to-amber-600 flex items-center justify-center shadow-lg border-2 border-amber-500"
              style={{ boxShadow: getRankGlow(3) }}
            >
              <MedalIcon type="bronze" />
            </motion.div>
          </div>
          
          <h3 className="text-lg sm:text-xl font-extrabold text-white truncate max-w-[150px] md:max-w-[130px] lg:max-w-[200px] mx-auto">
            {third.userName}
          </h3>
          
          <p className="text-gray-400 text-xs mt-1 font-semibold flex items-center justify-center gap-1">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            Wins: <span className="text-white font-bold">{third.winCount}</span>
          </p>

          <div className="border-t border-white/5 my-4" />

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-2 text-left text-xs mb-4">
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-wider mb-0.5">Quizzes</span>
              <span className="font-bold text-white flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5 text-blue-400" /> {third.quizzesTaken}
              </span>
            </div>
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-wider mb-0.5">Accuracy</span>
              <span className="font-bold text-teal-400 flex items-center gap-1">
                <Award className="w-3.5 h-3.5 text-teal-400" /> {thirdAccuracy}%
              </span>
            </div>
          </div>

          {/* Premium Score Section */}
          <div className="bg-linear-to-r from-slate-800 to-slate-900 border border-slate-700/50 rounded-2xl px-4 py-3 flex items-center justify-between shadow-md">
            <span className="text-[10px] text-slate-400 uppercase font-extrabold tracking-wider">Score</span>
            <span className="text-white font-black text-lg">
              <AnimatedScore value={third.totalScore} play={playCounter && inView} /> <span className="text-xs text-slate-400">PTS</span>
            </span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
