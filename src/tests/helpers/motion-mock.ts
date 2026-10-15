// A drop-in for framer-motion's `motion` and `AnimatePresence` that renders plain elements.
// Use it where real animations hit jsdom limits (its CSS parser rejects some animated values):
//   vi.mock('framer-motion', async (orig) => ({ ...(await orig()), ...(await import('@/tests/helpers/motion-mock')).motionPassthrough }));
import { createElement, forwardRef, Fragment, type ReactNode } from 'react';

const MOTION_PROPS = new Set([
  'initial', 'animate', 'exit', 'transition', 'variants', 'custom', 'layout', 'layoutId',
  'whileHover', 'whileTap', 'whileInView', 'whileFocus', 'whileDrag', 'viewport',
  'drag', 'dragConstraints', 'onAnimationStart', 'onAnimationComplete', 'onUpdate',
]);

const cache = new Map<string, unknown>();
const motion = new Proxy({}, {
  get: (_target, tag: string) => {
    if (!cache.has(tag)) {
      const Component = forwardRef<Element, Record<string, unknown>>((props, ref) => {
        const clean: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(props)) if (!MOTION_PROPS.has(key)) clean[key] = value;
        return createElement(tag, { ...clean, ref });
      });
      Component.displayName = `motion.${tag}`;
      cache.set(tag, Component);
    }
    return cache.get(tag);
  },
});

const AnimatePresence = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children);

export const motionPassthrough = { motion, AnimatePresence };
