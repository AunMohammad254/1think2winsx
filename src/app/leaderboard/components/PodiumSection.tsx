'use client';

import { useRef, useEffect } from 'react';
import { motion, useInView, animate } from 'framer-motion';
import { podiumCardVariants, springBouncy, springGentle, getRankGlow } from '../animations';

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
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
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
      className="text-4xl inline-block"
      animate={{ rotate: 360 }}
      transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
    >
      👑
    </motion.span>
  );
}

function MedalIcon({ type }: { type: 'silver' | 'bronze' }) {
  return (
    <div className="relative">
      <span className="text-3xl">{type === 'silver' ? '🥈' : '🥉'}</span>
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

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      className="flex justify-center items-end gap-4 sm:gap-6 mb-8"
    >
      {/* 2nd */}
      <motion.div
        variants={podiumCardVariants}
        custom={0}
        whileHover={
          !isMobile
            ? {
                y: -8,
                boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
                transition: springGentle,
              }
            : undefined
        }
        className={`${!isMobile ? 'backdrop-blur-xl' : ''} bg-linear-to-b from-gray-400/15 to-gray-600/15 border border-gray-400/25 rounded-3xl p-5 sm:p-6 shadow-2xl w-[160px] sm:w-[200px]`}
      >
        <div className="text-center">
          <div className="relative w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-3">
            <motion.div
              className="w-full h-full rounded-full bg-linear-to-r from-gray-300 to-gray-500 flex items-center justify-center shadow-lg"
              style={{ boxShadow: getRankGlow(2) }}
            >
              <MedalIcon type="silver" />
            </motion.div>
          </div>
          <h3 className="text-base sm:text-lg font-bold text-white truncate">{second.userName}</h3>
          <p className="text-gray-300 text-xs sm:text-sm mt-1">
            Score:{' '}
            <span className="font-bold text-white">
              <AnimatedScore value={second.totalScore} play={playCounter && inView} />
            </span>
          </p>
          <div className="bg-gray-400/15 rounded-full px-3 py-1 mt-2 inline-block">
            <span className="text-gray-300 text-xs">2nd Place</span>
          </div>
        </div>
      </motion.div>

      {/* 1st */}
      <motion.div
        variants={podiumCardVariants}
        custom={1}
        whileHover={
          !isMobile
            ? {
                y: -10,
                boxShadow: '0 25px 50px rgba(234,179,8,0.2)',
                transition: springGentle,
              }
            : undefined
        }
        className={`${!isMobile ? 'backdrop-blur-xl' : ''} bg-linear-to-b from-yellow-400/20 to-yellow-600/20 border border-yellow-400/30 rounded-3xl p-6 sm:p-8 shadow-2xl w-[180px] sm:w-[230px] -mt-4 sm:-mt-8`}
      >
        <div className="text-center">
          <motion.div
            className="relative w-20 h-20 sm:w-24 sm:h-24 mx-auto mb-3"
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <motion.div
              className="w-full h-full rounded-full bg-linear-to-r from-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg"
              style={{ boxShadow: getRankGlow(1) }}
              animate={{ boxShadow: [
                '0 0 20px rgba(234,179,8,0.4)',
                '0 0 50px rgba(234,179,8,0.6)',
                '0 0 20px rgba(234,179,8,0.4)',
              ] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <CrownIcon />
            </motion.div>
          </motion.div>
          <h3 className="text-lg sm:text-2xl font-bold bg-linear-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent truncate">
            {first.userName}
          </h3>
          <p className="text-gray-300 text-xs sm:text-sm mt-1">
            Score:{' '}
            <span className="font-bold text-white">
              <AnimatedScore value={first.totalScore} play={playCounter && inView} />
            </span>
          </p>
          <div className="bg-yellow-400/20 rounded-full px-3 sm:px-4 py-1 sm:py-2 mt-2 inline-block">
            <span className="text-yellow-300 font-bold text-xs sm:text-sm">Champion</span>
          </div>
        </div>
      </motion.div>

      {/* 3rd */}
      <motion.div
        variants={podiumCardVariants}
        custom={2}
        whileHover={
          !isMobile
            ? {
                y: -6,
                boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
                transition: springGentle,
              }
            : undefined
        }
        className={`${!isMobile ? 'backdrop-blur-xl' : ''} bg-linear-to-b from-amber-400/15 to-amber-600/15 border border-amber-400/25 rounded-3xl p-5 sm:p-6 shadow-2xl w-[160px] sm:w-[200px]`}
      >
        <div className="text-center">
          <div className="relative w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-3">
            <motion.div
              className="w-full h-full rounded-full bg-linear-to-r from-amber-400 to-amber-600 flex items-center justify-center shadow-lg"
              style={{ boxShadow: getRankGlow(3) }}
            >
              <MedalIcon type="bronze" />
            </motion.div>
          </div>
          <h3 className="text-base sm:text-lg font-bold text-white truncate">{third.userName}</h3>
          <p className="text-gray-300 text-xs sm:text-sm mt-1">
            Score:{' '}
            <span className="font-bold text-white">
              <AnimatedScore value={third.totalScore} play={playCounter && inView} />
            </span>
          </p>
          <div className="bg-amber-400/15 rounded-full px-3 py-1 mt-2 inline-block">
            <span className="text-amber-300 text-xs">3rd Place</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
