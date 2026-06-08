"use client";

import { Section, Reveal, useScrollReveal, useCountUp } from "./Primitives";

type Stat = { value: number; prefix?: string; suffix: string; label: string; icon: string; color: string };
const STATS: Stat[] = [
  { value: 10000, suffix: "+", label: "Active Players", icon: "👥", color: "from-emerald-400 to-cyan-400" },
  { value: 50000, prefix: "₹", suffix: "+", label: "Prizes Won", icon: "💰", color: "from-amber-400 to-orange-500" },
  { value: 500, suffix: "+", label: "Quizzes Live", icon: "🎯", color: "from-violet-400 to-pink-500" },
  { value: 24, suffix: "/7", label: "Always Live", icon: "⚡", color: "from-rose-400 to-amber-400" },
];

function StatCard({ stat, index, visible }: { stat: Stat; index: number; visible: boolean }) {
  const value = useCountUp(stat.value, 1800, visible);
  const formatNumber = (n: number) => n >= 1000 ? n.toLocaleString() : n.toString();
  return (
    <div className="reveal is-visible group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-6 backdrop-blur-xl lift" style={{ transitionDelay: `${index * 80}ms` }}>
      <div className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br ${stat.color} opacity-15 blur-2xl transition-opacity duration-500 group-hover:opacity-30`} />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
            {stat.prefix ?? ""}<span className="tabular-nums">{formatNumber(value)}</span>
            <span className={`bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`}>{stat.suffix}</span>
          </div>
          <p className="mt-2 text-sm font-medium uppercase tracking-[0.16em] text-white/55">{stat.label}</p>
        </div>
        <span className="text-2xl opacity-60 transition-transform duration-500 group-hover:scale-125">{stat.icon}</span>
      </div>
      <div className="relative mt-5 h-1 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full bg-gradient-to-r ${stat.color} transition-all duration-1000`} style={{ width: visible ? "100%" : "0%" }} />
      </div>
    </div>
  );
}

export default function Stats() {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>({ threshold: 0.2 });
  return (
    <Section id="stats" className="!py-16 sm:!py-20">
      <Reveal><p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">Trusted by cricket fans across the globe</p></Reveal>
      <div ref={ref} className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat, i) => <StatCard key={stat.label} stat={stat} index={i} visible={isVisible} />)}
      </div>
    </Section>
  );
}
