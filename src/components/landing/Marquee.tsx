"use client";

import { Reveal } from "./Primitives";

const PARTNERS = [
  { name: "ICC Cricket", icon: "🏏" },
  { name: "BCCI Approved", icon: "🇮🇳" },
  { name: "IPL Insider", icon: "🏆" },
  { name: "Cricbuzz Partner", icon: "📊" },
  { name: "Wisden", icon: "📖" },
  { name: "ESPN Cricinfo", icon: "🌐" },
  { name: "Star Sports", icon: "📺" },
  { name: "Hotstar", icon: "▶️" },
];

function Track({ items, reverse = false }: { items: typeof PARTNERS; reverse?: boolean }) {
  const doubled = [...items, ...items, ...items];
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-ink-950 to-transparent" />
      <div className="marquee-pause">
        <div
          className="marquee-track"
          style={{ animationDirection: reverse ? "reverse" : "normal", animationDuration: "35s" }}
        >
          {doubled.map((p, i) => (
            <div
              key={`${p.name}-${i}`}
              className="mx-6 flex shrink-0 items-center gap-3 grayscale transition-all duration-500 hover:grayscale-0"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/[0.04] text-lg shadow-sm transition-all duration-300 group-hover:border-white/30">
                {p.icon}
              </span>
              <span className="whitespace-nowrap font-display text-sm font-semibold uppercase tracking-wider text-white/40 transition-colors duration-300 hover:text-white/80">
                {p.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Marquee() {
  return (
    <section  className="relative border-y border-white/5 bg-ink-950/60 py-12">
      <Reveal>
        <p className="mb-7 text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45">
          As featured in
        </p>
      </Reveal>
      <div className="space-y-6">
        <Track items={PARTNERS} />
        <Track items={[...PARTNERS].reverse()} reverse />
      </div>
    </section>
  );
}
