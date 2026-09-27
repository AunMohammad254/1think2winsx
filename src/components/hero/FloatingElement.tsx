'use client';

import { motion } from 'framer-motion';
import { memo } from 'react';

export interface FloatingElementProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  x?: number;
  y?: number;
}

export const FloatingElement = memo(({
  children,
  delay = 0,
  duration = 6,
  x = 0,
  y = 0
}: FloatingElementProps) => (
  <motion.div
    className="absolute pointer-events-none select-none"
    style={{ left: `${x}%`, top: `${y}%` }}
    initial={{ opacity: 0, scale: 0 }}
    animate={{
      opacity: [0.3, 0.6, 0.3],
      scale: [0.8, 1.1, 0.8],
      y: [0, -20, 0],
      rotate: [0, 10, -10, 0]
    }}
    transition={{
      duration,
      delay,
      repeat: Infinity,
      ease: "easeInOut"
    }}
  >
    {children}
  </motion.div>
));

FloatingElement.displayName = 'FloatingElement';
