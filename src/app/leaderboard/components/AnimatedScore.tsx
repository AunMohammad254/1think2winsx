'use client';

import { useRef, useEffect } from 'react';
import { animate } from 'framer-motion';

interface AnimatedScoreProps {
  value: number;
  play: boolean;
  duration?: number;
}

export default function AnimatedScore({ value, play, duration = 0.6 }: AnimatedScoreProps) {
  const nodeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!play || !nodeRef.current) return;
    const from = parseInt(nodeRef.current.textContent || '0', 10);
    const controls = animate(from, value, {
      duration: duration,
      ease: 'easeOut',
      onUpdate: (latest) => {
        if (nodeRef.current) nodeRef.current.textContent = Math.round(latest).toString();
      },
    });
    return controls.stop;
  }, [value, play, duration]);

  return <span ref={nodeRef}>{value}</span>;
}
