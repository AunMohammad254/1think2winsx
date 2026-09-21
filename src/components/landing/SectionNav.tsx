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
      target.scrollIntoView({ behavior: "smooth" });
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
