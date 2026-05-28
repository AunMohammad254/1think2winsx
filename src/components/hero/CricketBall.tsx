'use client';

import { motion } from 'framer-motion';
import { memo } from 'react';

export const CricketBall = memo(() => (
  <motion.div
    className="relative w-48 h-48 md:w-64 md:h-64 lg:w-80 lg:h-80"
    initial={{ scale: 0, rotateY: -180 }}
    animate={{ scale: 1, rotateY: 0 }}
    transition={{ duration: 0.8, delay: 0.4, type: "spring", stiffness: 100 }}
  >
    {/* Glow effect */}
    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[var(--color-accent)]/30 to-[var(--color-primary)]/20 blur-2xl animate-pulse" />

    {/* Main ball */}
    <motion.div
      className="relative w-full h-full rounded-full"
      style={{
        background: 'radial-gradient(circle at 30% 30%, #dc2626 0%, #991b1b 50%, #7f1d1d 100%)',
        boxShadow: `
          inset -20px -20px 40px rgba(0,0,0,0.4),
          inset 10px 10px 30px rgba(255,255,255,0.2),
          0 20px 60px rgba(0,0,0,0.5),
          0 0 80px rgba(var(--color-accent-rgb), 0.3)
        `
      }}
      animate={{
        rotateZ: [0, 360],
      }}
      transition={{
        duration: 20,
        repeat: Infinity,
        ease: "linear"
      }}
    >
      {/* Seam lines */}
      <div className="absolute inset-4 rounded-full border-2 border-white/20"
        style={{
          borderStyle: 'dashed',
          transform: 'rotateX(60deg) rotateZ(20deg)'
        }}
      />
      <div className="absolute inset-4 rounded-full border-2 border-white/20"
        style={{
          borderStyle: 'dashed',
          transform: 'rotateX(60deg) rotateZ(-20deg)'
        }}
      />

      {/* Highlight */}
      <div
        className="absolute top-[15%] left-[20%] w-[25%] h-[20%] rounded-full"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.6) 0%, transparent 70%)'
        }}
      />
    </motion.div>
  </motion.div>
));

CricketBall.displayName = 'CricketBall';
