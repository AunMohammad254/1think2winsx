"use client";

import { useEffect, useRef } from "react";
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

// Any of these means the user is steering the page themselves, so stop re-aiming.
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "mousedown"] as const;

// An explicit `behavior` overrides the reduced-motion rule in globals.css, so check it here.
const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export default function SectionNav() {
  const { activeId, setActiveId } = useActiveSection(SECTIONS.map((s) => s.id));
  const stopFollowRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopFollowRef.current?.(), []);

  // Every section after the hero is a LazySection: a short placeholder until it nears the
  // viewport, then its full-height content. A smooth scroll to a far section mounts the
  // sections it passes, which pushes the target further down, so a single scrollIntoView
  // stops short of it. Re-aim whenever the target moves, until the scroll settles.
  const scrollToSection = (target: HTMLElement) => {
    stopFollowRef.current?.();

    const targetTop = () => target.getBoundingClientRect().top + window.scrollY;
    let aimedAt = targetTop();
    let lastScrollY = window.scrollY;
    let stillFrames = 0;
    let frame = 0;
    const giveUpAt = performance.now() + 5000;

    const stop = () => {
      cancelAnimationFrame(frame);
      USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, stop));
      stopFollowRef.current = null;
    };

    const follow = () => {
      const top = targetTop();
      if (Math.abs(top - aimedAt) > 1) {
        aimedAt = top;
        stillFrames = 0;
        target.scrollIntoView({ behavior: scrollBehavior() });
      } else {
        stillFrames = window.scrollY === lastScrollY ? stillFrames + 1 : 0;
      }
      lastScrollY = window.scrollY;

      if (stillFrames >= 30 || performance.now() > giveUpAt) stop();
      else frame = requestAnimationFrame(follow);
    };

    USER_SCROLL_EVENTS.forEach((type) => window.addEventListener(type, stop, { passive: true }));
    stopFollowRef.current = stop;
    target.scrollIntoView({ behavior: scrollBehavior() });
    frame = requestAnimationFrame(follow);
  };

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    e.preventDefault();

    // Immediately set active state for instant feedback
    setActiveId(sectionId);

    const target = document.getElementById(sectionId);
    if (target) {
      scrollToSection(target);
      window.history.pushState(null, "", `#${sectionId}`);
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
