'use client';

import { useEffect, useState } from 'react';

/**
 * Keeps a closing element mounted for `exitMs` so its CSS exit animation can play, then unmounts it.
 * A small stand-in for framer-motion's AnimatePresence: render while this returns true and set
 * `data-state={open ? 'open' : 'closed'}` so the CSS picks the enter or exit keyframes.
 */
export function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  // Mount in the same render that opens, so the enter animation starts on the first frame
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const id = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(id);
  }, [open, mounted, exitMs]);

  return mounted;
}
