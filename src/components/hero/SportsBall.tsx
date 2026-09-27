'use client';

import { motion } from 'framer-motion';
import { memo } from 'react';

export type SportsBallType = 'cricket' | 'basketball' | 'tennis' | 'football';

interface SportsBallProps {
  className?: string;
  type?: SportsBallType;
}

export const SportsBall = memo(({ className = "", type = "cricket" }: SportsBallProps) => {
  const getBallStyles = () => {
    switch (type) {
      case 'basketball':
        return {
          background: 'radial-gradient(circle at 30% 30%, #ea580c 0%, #c2410c 50%, #9a3412 100%)',
          accent: 'rgba(234, 88, 12, 0.3)',
        };
      case 'tennis':
        return {
          background: 'radial-gradient(circle at 30% 30%, #bef264 0%, #a3e635 50%, #65a30d 100%)',
          accent: 'rgba(163, 230, 53, 0.3)',
        };
      case 'football':
        return {
          background: 'radial-gradient(circle at 30% 30%, #ffffff 0%, #f1f5f9 50%, #94a3b8 100%)',
          accent: 'rgba(255, 255, 255, 0.3)',
        };
      case 'cricket':
      default:
        return {
          background: 'radial-gradient(circle at 30% 30%, #dc2626 0%, #991b1b 50%, #7f1d1d 100%)',
          accent: 'rgba(220, 38, 38, 0.3)',
        };
    }
  };

  const styles = getBallStyles();

  return (
    <motion.div
      className={`relative w-48 h-48 md:w-64 md:h-64 lg:w-80 lg:h-80 ${className}`}
      initial={{ scale: 0, rotateY: -180 }}
      animate={{ scale: 1, rotateY: 0 }}
      transition={{ duration: 0.8, delay: 0.4, type: "spring", stiffness: 100 }}
    >
      {/* Glow effect */}
      <div 
        className="absolute inset-0 rounded-full blur-2xl animate-pulse" 
        style={{ background: `radial-gradient(circle, ${styles.accent} 0%, transparent 70%)` }}
      />

      {/* Main ball */}
      <motion.div
        className="relative w-full h-full rounded-full overflow-hidden"
        style={{
          background: styles.background,
          boxShadow: `
            inset -20px -20px 40px rgba(0,0,0,0.4),
            inset 10px 10px 30px rgba(255,255,255,0.2),
            0 20px 60px rgba(0,0,0,0.5),
            0 0 80px ${styles.accent}
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
        {/* Ball Details based on type */}
        {type === 'cricket' && (
          <>
            <div className="absolute inset-4 rounded-full border-2 border-white/20"
              style={{ borderStyle: 'dashed', transform: 'rotateX(60deg) rotateZ(20deg)' }}
            />
            <div className="absolute inset-4 rounded-full border-2 border-white/20"
              style={{ borderStyle: 'dashed', transform: 'rotateX(60deg) rotateZ(-20deg)' }}
            />
          </>
        )}

        {type === 'basketball' && (
          <>
            <div className="absolute top-1/2 left-0 right-0 h-1 bg-black/40 -translate-y-1/2" />
            <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-black/40 -translate-x-1/2" />
            <div className="absolute inset-4 rounded-full border-[3px] border-black/40" style={{ transform: 'rotateX(75deg)' }} />
          </>
        )}

        {type === 'tennis' && (
          <>
            <div className="absolute w-[120%] h-[120%] rounded-full border-4 border-white/70" style={{ top: '-60%', left: '-20%' }} />
            <div className="absolute w-[120%] h-[120%] rounded-full border-4 border-white/70" style={{ bottom: '-60%', right: '-20%' }} />
          </>
        )}

        {type === 'football' && (
          <>
             {/* Simple pentagon pattern for football */}
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1/3 h-1/3 bg-slate-800 rounded-sm" style={{ clipPath: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)' }} />
             <div className="absolute top-0 left-0 w-[40%] h-[4px] bg-slate-800 origin-left" style={{ transform: 'rotate(45deg)' }} />
             <div className="absolute top-0 right-0 w-[40%] h-[4px] bg-slate-800 origin-right" style={{ transform: 'rotate(-45deg)' }} />
             <div className="absolute bottom-0 left-[20%] w-[4px] h-[40%] bg-slate-800 origin-bottom" style={{ transform: 'rotate(-20deg)' }} />
             <div className="absolute bottom-0 right-[20%] w-[4px] h-[40%] bg-slate-800 origin-bottom" style={{ transform: 'rotate(20deg)' }} />
          </>
        )}

        {/* Highlight */}
        <div
          className="absolute top-[15%] left-[20%] w-[25%] h-[20%] rounded-full"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.6) 0%, transparent 70%)'
          }}
        />
      </motion.div>
    </motion.div>
  );
});

SportsBall.displayName = 'SportsBall';
