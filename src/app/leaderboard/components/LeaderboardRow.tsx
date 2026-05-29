'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, useInView, animate } from 'framer-motion';
import { rowVariants, getRankGradient, getRankIcon, getRankGlow, springGentle } from '../animations';
import { Trophy, HelpCircle, Target, Award } from 'lucide-react';

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

type PrevData = Map<string, { rank: number; score: number }>;

function AnimatedScore({ value, play }: { value: number; play: boolean }) {
  const nodeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!play || !nodeRef.current) return;
    const from = parseInt(nodeRef.current.textContent || '0', 10);
    const controls = animate(from, value, {
      duration: 0.6,
      ease: 'easeOut',
      onUpdate: (latest) => {
        if (nodeRef.current) nodeRef.current.textContent = Math.round(latest).toString();
      },
    });
    return controls.stop;
  }, [value, play]);

  return <span ref={nodeRef}>{value}</span>;
}

function ScoreFlash({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <motion.span
      initial={{ opacity: 0.6 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      className="absolute inset-0 rounded-2xl bg-white/20 pointer-events-none"
    />
  );
}

export default function LeaderboardRow({
  entry,
  index,
  isCurrentUser,
  prevData,
  isMobile,
  playCounter,
}: {
  entry: LeaderboardEntry;
  index: number;
  isCurrentUser: boolean;
  prevData: PrevData;
  isMobile: boolean;
  playCounter: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-30px' });
  const [scoreFlash, setScoreFlash] = useState(false);

  const prev = prevData.get(entry.userName);
  const rankChanged = prev && prev.rank !== entry.rank;
  const scoreChanged = prev && prev.score !== entry.totalScore;

  useEffect(() => {
    if (scoreChanged && inView) {
      setScoreFlash(true);
      const t = setTimeout(() => setScoreFlash(false), 900);
      return () => clearTimeout(t);
    }
  }, [entry.totalScore, inView, scoreChanged]);

  const rankDiff = prev ? prev.rank - entry.rank : 0;
  const isNewEntry = !prev && entry.rank <= 3;

  const rankGradient = getRankGradient(entry.rank);
  const glow = getRankGlow(entry.rank);
  const isTop3 = entry.rank <= 3;

  // Accuracy calculation based on correct answers and total quizzes (assuming 10 questions/quiz on average)
  const accuracy = entry.quizzesTaken > 0 
    ? Math.round((entry.correctAnswers / (entry.quizzesTaken * 10)) * 100) 
    : 0;

  const rowBase = 'bg-slate-950/40 border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-center justify-between gap-4 transition-all duration-300';
  const highlightClass = isCurrentUser
    ? 'bg-linear-to-r from-emerald-500/10 via-emerald-600/5 to-teal-500/10 border border-emerald-500/50 shadow-[0_0_25px_-5px_rgba(16,185,129,0.15)]'
    : 'hover:border-emerald-500/30 hover:shadow-[0_0_20px_-5px_rgba(16,185,129,0.08)]';

  return (
    <motion.div
      ref={ref}
      variants={rowVariants}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      custom={index}
      whileHover={
        !isMobile
          ? {
              scale: 1.01,
              transition: { duration: 0.15 },
            }
          : undefined
      }
      className={`${rowBase} ${highlightClass} ${isNewEntry ? 'border-t-emerald-400' : ''}`}
    >
      {/* LEFT BLOCK: Rank, Avatar, Username */}
      <div className="flex flex-row items-center gap-3 sm:gap-4 w-full md:w-auto self-start md:self-center min-w-0">
        {/* Rank Number & Icon */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-[60px] sm:min-w-[70px] shrink-0">
          {isTop3 ? (
            <motion.div
              className={`flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-linear-to-r ${rankGradient} shadow-lg`}
              whileHover={!isMobile ? { scale: 1.1, transition: springGentle } : undefined}
              style={glow !== 'none' ? { boxShadow: glow } : undefined}
            >
              <span className="text-white font-extrabold text-base sm:text-lg">{entry.rank}</span>
            </motion.div>
          ) : (
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-800 border border-white/10">
              <span className="text-slate-300 font-bold text-sm">{entry.rank}</span>
            </div>
          )}
          <span className="text-xl sm:text-2xl shrink-0">
            {getRankIcon(entry.rank)}
          </span>

          {/* Rank Change Indicator */}
          {rankChanged && (
            <div className="flex flex-col items-center">
              {rankDiff > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-0.5 text-emerald-400 font-bold"
                >
                  <span className="text-xs">↑</span>
                  <span className="text-[10px]">+{rankDiff}</span>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-0.5 text-red-400 font-bold"
                >
                  <span className="text-xs">↓</span>
                  <span className="text-[10px]">{rankDiff}</span>
                </motion.div>
              )}
            </div>
          )}
        </div>

        {/* Player Profile Avatar & Username */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-gradient-to-tr from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center shadow-md font-bold text-white shrink-0 text-sm">
            {entry.userName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-extrabold text-white truncate max-w-[110px] sm:max-w-[150px] md:max-w-[110px] lg:max-w-[180px] xl:max-w-[240px]">
              {entry.userName}
            </div>
            {isCurrentUser && (
              <span className="inline-flex items-center px-2 py-0.5 mt-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                You
              </span>
            )}
          </div>
        </div>
      </div>

      {/* CENTER BLOCK: Gamer Statistics Grid */}
      <div className="grid grid-cols-4 gap-2 sm:gap-4 w-full md:w-auto md:flex md:items-center md:gap-3 lg:gap-5 xl:gap-6 text-center md:text-left pt-2 md:pt-0 border-t border-white/5 md:border-t-0 shrink-0">
        
        {/* Wins Count */}
        <div className="flex flex-col items-center md:items-start">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1">
            <Trophy className="w-3 h-3 text-yellow-400 shrink-0" /> Wins
          </span>
          {entry.winCount > 0 ? (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-2.5 py-0.5 font-bold text-yellow-400 text-sm flex items-center gap-0.5 shadow-sm">
              {entry.winCount} <span className="text-xs">🏆</span>
            </div>
          ) : (
            <span className="text-slate-400 text-sm font-medium">0</span>
          )}
        </div>

        {/* Quizzes Taken */}
        <div className="flex flex-col items-center md:items-start">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1">
            <HelpCircle className="w-3 h-3 text-blue-400 shrink-0" /> Play
          </span>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-2.5 py-0.5 font-bold text-blue-400 text-sm shadow-sm">
            {entry.quizzesTaken}
          </div>
        </div>

        {/* Correct Answers */}
        <div className="flex flex-col items-center md:items-start">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1">
            <Target className="w-3 h-3 text-emerald-400 shrink-0" /> Correct
          </span>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-0.5 font-bold text-emerald-400 text-sm shadow-sm">
            {entry.correctAnswers}
          </div>
        </div>

        {/* Accuracy Rate */}
        <div className="flex flex-col items-center md:items-start">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1">
            <Award className="w-3 h-3 text-teal-400 shrink-0" /> Accuracy
          </span>
          <div className="bg-teal-500/10 border border-teal-500/20 rounded-lg px-2.5 py-0.5 font-bold text-teal-400 text-sm shadow-sm">
            {accuracy}%
          </div>
        </div>

      </div>

      {/* RIGHT BLOCK: Premium Score Badge */}
      <div className="relative w-full md:w-auto shrink-0 flex justify-end md:block mt-2 md:mt-0">
        <motion.div
          className="bg-linear-to-r from-emerald-500/25 to-teal-500/25 hover:from-emerald-500/35 hover:to-teal-500/35 border border-emerald-500/40 rounded-xl px-4 md:px-2.5 lg:px-4 py-2.5 flex items-center justify-center gap-2 shadow-md w-full md:w-auto md:min-w-[105px] lg:min-w-[130px]"
          whileHover={!isMobile ? { scale: 1.05, transition: springGentle } : undefined}
        >
          <span className="text-white font-extrabold text-lg tracking-tight">
            <AnimatedScore value={entry.totalScore} play={playCounter && inView} />
          </span>
          <span className="text-emerald-300 font-extrabold text-xs tracking-wider uppercase">PTS</span>
        </motion.div>
        <ScoreFlash show={scoreFlash} />
      </div>

    </motion.div>
  );
}
