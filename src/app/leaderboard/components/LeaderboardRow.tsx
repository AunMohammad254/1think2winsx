'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, useInView, animate } from 'framer-motion';
import { rowVariants, getRankGradient, getRankIcon, getRankGlow, springGentle } from '../animations';

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
      className="absolute inset-0 rounded-lg bg-white/20 pointer-events-none"
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
  const ref = useRef<HTMLTableRowElement>(null);
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
  }, [entry.totalScore, inView]);

  const rankDiff = prev ? prev.rank - entry.rank : 0;
  const isNewEntry = !prev && entry.rank <= 3;

  const rankGradient = getRankGradient(entry.rank);
  const glow = getRankGlow(entry.rank);
  const isTop3 = entry.rank <= 3;

  const rowBase = isMobile
    ? 'bg-slate-800/90 border-b border-white/5'
    : 'backdrop-blur-xl bg-white/[0.02] border-b border-white/5';

  const highlightClass = isCurrentUser
    ? 'bg-linear-to-r from-emerald-500/15 to-teal-600/15 border-l-2 border-emerald-400'
    : '';

  return (
    <motion.tr
      ref={ref}
      variants={rowVariants}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      custom={index}
      whileHover={
        !isMobile
          ? {
              backgroundColor: 'rgba(255,255,255,0.06)',
              scale: 1.003,
              transition: { duration: 0.15 },
            }
          : undefined
      }
      className={`group ${rowBase} ${highlightClass} ${isNewEntry ? 'border-t-2 border-t-green-400/40' : ''}`}
      style={isCurrentUser && !isMobile ? { boxShadow: '0 0 20px rgba(5,150,105,0.08)' } : undefined}
    >
      <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-3">
          {isTop3 ? (
            <motion.div
              className={`flex items-center justify-center w-12 h-12 rounded-full bg-linear-to-r ${rankGradient} shadow-lg`}
              whileHover={!isMobile ? { scale: 1.12, transition: springGentle } : undefined}
              style={glow !== 'none' ? { boxShadow: glow } : undefined}
            >
              <span className="text-white font-bold text-lg">{entry.rank}</span>
            </motion.div>
          ) : (
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-linear-to-r from-slate-600 to-slate-700 border border-white/20 shadow-lg">
              <span className="text-white font-bold text-sm">{entry.rank}</span>
            </div>
          )}
          <motion.span
            className="text-2xl"
            animate={isTop3 ? { rotate: [0, 5, 0, -5, 0] } : undefined}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            {getRankIcon(entry.rank)}
          </motion.span>
        </div>
      </td>

      <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-3">
          <motion.div
            className="w-10 h-10 bg-linear-to-r from-emerald-400 to-teal-600 rounded-full flex items-center justify-center shadow-lg"
            whileHover={!isMobile ? { scale: 1.1, rotate: 5 } : undefined}
          >
            <span className="text-white font-bold text-sm">
              {entry.userName.charAt(0).toUpperCase()}
            </span>
          </motion.div>
          <div>
            <div className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors duration-300">
              {entry.userName}
            </div>
            {isCurrentUser && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/30 text-emerald-300 border border-emerald-500/50">
                You
              </span>
            )}
          </div>
        </div>
      </td>

      <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
        <div className="bg-blue-500/20 rounded-lg px-3 py-1 border border-blue-500/30 inline-block">
          <span className="text-blue-300 font-medium">{entry.quizzesTaken}</span>
        </div>
      </td>

      <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
        <div className="bg-green-500/20 rounded-lg px-3 py-1 border border-green-500/30 inline-block">
          <span className="text-green-300 font-medium">{entry.correctAnswers}</span>
        </div>
      </td>

      <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
        <div className="relative inline-block">
          <motion.div
            className="bg-linear-to-r from-emerald-500/20 to-teal-500/20 rounded-lg px-4 py-2 border border-emerald-500/30"
            whileHover={!isMobile ? { scale: 1.05, transition: springGentle } : undefined}
          >
            <span className="text-white font-bold text-lg">
              <AnimatedScore value={entry.totalScore} play={playCounter && inView} />
            </span>
          </motion.div>
          <ScoreFlash show={scoreFlash} />
        </div>
      </td>

      <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
        {entry.winCount > 0 ? (
          <div className="bg-yellow-500/20 rounded-lg px-3 py-1 border border-yellow-500/30 inline-flex items-center gap-1">
            <span className="text-yellow-300 font-bold">{entry.winCount}</span>
            <span className="text-yellow-400">🏆</span>
          </div>
        ) : (
          <div className="bg-gray-500/20 rounded-lg px-3 py-1 border border-gray-500/30 inline-block">
            <span className="text-gray-400">0</span>
          </div>
        )}
      </td>

      {rankChanged && (
        <td className="pr-4 sm:pr-6 py-4 whitespace-nowrap">
          {rankDiff > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-1 text-green-400"
            >
              <motion.span
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 0.5, repeat: 3 }}
                className="text-sm"
              >
                ↑
              </motion.span>
              <span className="text-xs font-medium">+{rankDiff}</span>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-1 text-red-400"
            >
              <motion.span
                animate={{ x: [0, -2, 2, -2, 0] }}
                transition={{ duration: 0.4, repeat: 3 }}
                className="text-sm"
              >
                ↓
              </motion.span>
              <span className="text-xs font-medium">{rankDiff}</span>
            </motion.div>
          )}
        </td>
      )}
    </motion.tr>
  );
}
