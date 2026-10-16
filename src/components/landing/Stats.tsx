"use client";

import { useRef, useState, useCallback } from "react";
import { Section, Reveal, useScrollReveal, useCountUp } from "./Primitives";

// ring: the progress ring's gradient stops, matching the from/to colours in `color`
type Stat = { value: number; prefix?: string; suffix: string; label: string; icon: string; color: string; ring: [string, string] };
const STATS: Stat[] = [
  { value: 10000, suffix: "+", label: "Active Players", icon: "👥", color: "from-emerald-400 to-cyan-400", ring: ["#34d399", "#22d3ee"] },
  { value: 50000, prefix: "", suffix: " PKR+", label: "Prizes Won", icon: "💰", color: "from-amber-400 to-orange-500", ring: ["#fbbf24", "#f97316"] },
  { value: 500, suffix: "+", label: "Quizzes Live", icon: "🎯", color: "from-violet-400 to-pink-500", ring: ["#a78bfa", "#e879f9"] },
  { value: 24, suffix: "/7", label: "Always Live", icon: "⚡", color: "from-rose-400 to-amber-400", ring: ["#fb7185", "#fbbf24"] },
];

const CIRC = 2 * Math.PI * 40;

function RadialStat({ stat, index, visible }: { stat: Stat; index: number; visible: boolean }) {
  const countRef = useCountUp(stat.value, 1800, visible);
  const fraction = Math.min(stat.value / 50000, 1);
  const offset = CIRC - fraction * CIRC;

  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-6 backdrop-blur-xl lift"
      style={{ animation: visible ? `fade-up 0.5s ease-out ${index * 0.1}s both` : "none" }}
    >
      <div className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br ${stat.color} opacity-15 blur-2xl transition-opacity duration-500 group-hover:opacity-30`} />
      <div className="relative flex items-center gap-5">
        <div className="relative h-24 w-24 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full radial-progress-ring">
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              stroke={`url(#ring-grad-${index})`}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={visible ? offset : CIRC}
              style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1) 0.3s" }}
            />
            <defs>
              <linearGradient id={`ring-grad-${index}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={stat.ring[0]} />
                <stop offset="100%" stopColor={stat.ring[1]} />
              </linearGradient>
            </defs>
          </svg>
          <span className="absolute inset-0 grid place-items-center text-2xl transition-transform duration-500 group-hover:scale-110">{stat.icon}</span>
        </div>
        <div className="flex-1">
          <div className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {stat.prefix ?? ""}<span ref={countRef as React.RefObject<HTMLSpanElement>} className="tabular-nums">0</span>
            <span className={`bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`}>{stat.suffix}</span>
          </div>
          <p className="mt-1 text-sm font-medium uppercase tracking-[0.16em] text-white/55">{stat.label}</p>
        </div>
      </div>
    </div>
  );
}

export default function Stats() {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>({ threshold: 0.15 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!scrollRef.current || window.innerWidth >= 640) return;
    setIsDragging(true);
    startX.current = e.pageX - scrollRef.current.offsetLeft;
    scrollLeft.current = scrollRef.current.scrollLeft;
  }, []);

  const onMouseUp = useCallback(() => setIsDragging(false), []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !scrollRef.current || window.innerWidth >= 640) return;
      e.preventDefault();
      const x = e.pageX - scrollRef.current.offsetLeft;
      const walk = (x - startX.current) * 2;
      scrollRef.current.scrollLeft = scrollLeft.current - walk;
    },
    [isDragging]
  );

  return (
    <Section  className="!py-16 sm:!py-20">
      <Reveal>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          Trusted by sports fans across the globe
        </p>
      </Reveal>
      <div
        ref={ref}
        className="relative mt-10"
      >
        <div
          ref={scrollRef}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseUp}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto scrollbar-none sm:grid sm:grid-cols-2 lg:grid-cols-4"
          style={{ cursor: isDragging ? "grabbing" : undefined }}
        >
          {STATS.map((stat, i) => (
            <div key={stat.label} className="min-w-[260px] snap-start sm:min-w-0">
              <RadialStat stat={stat} index={i} visible={isVisible} />
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
