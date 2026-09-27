'use client';

import { type Variants, type Transition, type UseInViewOptions } from 'framer-motion';

export const springStiff: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 24,
};

export const springGentle: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 28,
};

export const springBouncy: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 15,
};

export const smoothTween: Transition = {
  type: 'tween',
  duration: 0.5,
  ease: [0.25, 0.1, 0.25, 1],
};

export const fastTween: Transition = {
  type: 'tween',
  duration: 0.3,
  ease: 'easeOut',
};

export const inViewOptions: UseInViewOptions = { once: true, margin: '-50px' };

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

export const staggerContainerFast: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: springGentle },
};

export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -20 },
  visible: { opacity: 1, y: 0, transition: springGentle },
};

export const fadeInLeft: Variants = {
  hidden: { opacity: 0, x: -30 },
  visible: { opacity: 1, x: 0, transition: springGentle },
};

export const fadeInRight: Variants = {
  hidden: { opacity: 0, x: 30 },
  visible: { opacity: 1, x: 0, transition: springGentle },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: { opacity: 1, scale: 1, transition: springBouncy },
};

export const slideUp: Variants = {
  hidden: { opacity: 0, y: 60 },
  visible: { opacity: 1, y: 0, transition: springGentle },
};

export const letterReveal: Variants = {
  hidden: { opacity: 0, y: 30, rotateX: -90 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    rotateX: 0,
    transition: {
      type: 'spring',
      stiffness: 200,
      damping: 20,
      delay: i * 0.04,
    },
  }),
};

export const floatSlow: Variants = {
  animate: {
    y: [0, -20, 0],
    transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' },
  },
};

export const floatMedium: Variants = {
  animate: {
    y: [0, -15, 0],
    transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
  },
};

export const floatFast: Variants = {
  animate: {
    y: [0, -10, 0],
    transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
  },
};

export const softPulse: Variants = {
  animate: {
    opacity: [0.7, 1, 0.7],
    scale: [1, 1.02, 1],
    transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
  },
};

export const glowPulse: Variants = {
  animate: {
    boxShadow: [
      '0 0 20px rgba(5,150,105,0.3)',
      '0 0 40px rgba(20,184,166,0.5)',
      '0 0 20px rgba(5,150,105,0.3)',
    ],
    transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
  },
};

export const shimmerVariants: Variants = {
  animate: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: { duration: 2, repeat: Infinity, ease: 'linear' },
  },
};

export const podiumCardVariants: Variants = {
  hidden: { opacity: 0, y: 100 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      ...springBouncy,
      delay: 0.15 + i * 0.12,
    },
  }),
};

export const rowVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      ...springGentle,
      delay: 0.02 * i,
    },
  }),
};

export const rippleVariants: Variants = {
  initial: { scale: 0, opacity: 0.4 },
  animate: { scale: 4, opacity: 0 },
  exit: { opacity: 0 },
};

export const errorShake: Variants = {
  animate: {
    x: [0, -10, 10, -10, 10, -5, 5, 0],
    transition: { duration: 0.6, ease: 'easeInOut' },
  },
};

export const slideInError: Variants = {
  hidden: { x: 80, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: springGentle },
};

export const backToTopVariants: Variants = {
  hidden: { opacity: 0, scale: 0.5, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0, transition: springBouncy },
  exit: { opacity: 0, scale: 0.5, y: 20, transition: fastTween },
};

export const skeletonShimmer = {
  background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.04) 100%)',
  backgroundSize: '200% 100%',
};

export function getRankGradient(rank: number): string {
  if (rank === 1) return 'from-yellow-400 via-yellow-500 to-yellow-600';
  if (rank === 2) return 'from-gray-300 via-gray-400 to-gray-500';
  if (rank === 3) return 'from-amber-400 via-amber-500 to-amber-600';
  if (rank <= 10) return 'from-emerald-400 via-emerald-500 to-teal-600';
  if (rank <= 25) return 'from-cyan-400 via-cyan-500 to-blue-600';
  return 'from-blue-400 via-blue-500 to-indigo-600';
}

export function getRankIcon(rank: number): string {
  if (rank === 1) return '👑';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '🏆';
}

export function getRankGlow(rank: number): string {
  if (rank === 1) return '0 0 30px rgba(234,179,8,0.4), 0 0 60px rgba(234,179,8,0.2)';
  if (rank === 2) return '0 0 20px rgba(156,163,175,0.3), 0 0 40px rgba(156,163,175,0.15)';
  if (rank === 3) return '0 0 20px rgba(217,119,6,0.3), 0 0 40px rgba(217,119,6,0.15)';
  return 'none';
}
