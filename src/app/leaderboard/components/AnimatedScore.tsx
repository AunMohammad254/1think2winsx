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
    const from = Number(nodeRef.current.textContent); // the span always shows a whole number
    const controls = animate(from, value, {
      duration: duration,
      ease: 'easeOut',
      onUpdate: (latest) => {
        // React clears the ref on unmount before this effect's cleanup stops the animation,
        // so a frame can still land after the span is gone
        if (nodeRef.current) nodeRef.current.textContent = Math.round(latest).toString();
      },
    });
    return controls.stop;
  }, [value, play, duration]);

  return <span ref={nodeRef}>{value}</span>;
}
