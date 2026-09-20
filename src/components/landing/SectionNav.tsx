"use client";

import { useRef } from "react";
import { useActiveSection } from "./Primitives";

const SECTIONS = [
  { id: "top", label: "Home" },
  { id: "stats", label: "Stats" },
  { id: "marquee", label: "Featured" },
  { id: "how", label: "How It Works" },
  { id: "live", label: "Live Quiz" },
  { id: "prizes", label: "Prizes" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "reviews", label: "Reviews" },
  { id: "cta", label: "Get Started" },
];

// Smooth easing function
const easeInOutCubic = (t: number): number => {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

// Custom smooth scroll with better easing
const smoothScrollTo = (targetY: number, duration: number = 800) => {
  const startY = window.scrollY;
  const distance = targetY - startY;
  const startTime = performance.now();
  let rafId: number;

  const scroll = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = easeInOutCubic(progress);
    const newY = startY + distance * ease;

    window.scrollTo(0, newY);

    if (progress < 1) {
      rafId = requestAnimationFrame(scroll);
    }
  };

  rafId = requestAnimationFrame(scroll);
};

export default function SectionNav() {
  const { activeId, setActiveId } = useActiveSection(SECTIONS.map((s) => s.id));
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    e.preventDefault();
    
    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    // Immediately set active state for instant feedback
    setActiveId(sectionId);
    
    const target = document.getElementById(sectionId);
    if (target) {
      // Account for fixed navbar height (~80px) when scrolling
      const navbarOffset = 80;
      const targetPosition = target.getBoundingClientRect().top + window.scrollY - navbarOffset;
      
      // Use custom smooth scroll with easing
      smoothScrollTo(targetPosition, 800);
      
      // Update URL after scroll starts (debounced)
      scrollTimeoutRef.current = setTimeout(() => {
        history.pushState(null, '', `#${sectionId}`);
      }, 100);
    }
  };

  return (
    <nav aria-label="Page sections" className="fixed right-4 top-1/2 z-50 hidden -translate-y-1/2 flex-col items-end gap-3 lg:flex">
      {SECTIONS.map((s) => {
        const isActive = activeId === s.id;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="group flex items-center gap-3 transition-all duration-300"
            onClick={(e) => handleClick(e, s.id)}
          >
            <span
              className={`text-right text-xs font-medium tracking-wider transition-all duration-300 ${
                isActive
                  ? "text-emerald-400 opacity-100"
                  : "text-white/35 opacity-0 group-hover:opacity-70"
              }`}
            >
              {s.label}
            </span>
            <span
              className={`block h-2 w-2 rounded-full transition-all duration-300 ${
                isActive
                  ? "section-nav-dot-active h-3 w-3"
                  : "bg-white/20 group-hover:bg-white/40"
              }`}
            />
          </a>
        );
      })}
    </nav>
  );
}
