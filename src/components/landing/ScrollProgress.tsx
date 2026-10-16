"use client";

import { useEffect, useRef } from "react";

export default function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The bar is always rendered; a frame that lands after unmount writes to a detached node
    const bar = ref.current!;
    let raf = 0;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      raf = requestAnimationFrame(() => {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? Math.min(window.scrollY / docHeight, 1) : 0;
        bar.style.transform = `scaleX(${progress})`;
        ticking = false;
      });
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="fixed left-0 top-0 z-[60] h-[3px] origin-left bg-gradient-to-r from-emerald-400 via-amber-300 to-orange-500 w-full shadow-[0_0_20px_rgba(16,185,129,0.4)]"
      style={{ transform: "scaleX(0)" }}
    />
  );
}

