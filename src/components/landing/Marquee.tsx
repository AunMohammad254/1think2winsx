"use client";

import { Reveal } from "./Primitives";

const PARTNERS = ["ICC Cricket", "BCCI Approved", "IPL Insider", "Cricbuzz Partner", "Wisden", "ESPN Cricinfo", "Star Sports", "Hotstar"];

export default function Marquee() {
  const items = [...PARTNERS, ...PARTNERS];
  return (
    <section className="relative border-y border-white/5 bg-ink-950/60 py-10">
      <Reveal><p className="mb-6 text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45">As featured in</p></Reveal>
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-ink-950 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-ink-950 to-transparent" />
        <div className="marquee-pause">
          <div className="marquee-track gap-12 px-6">
            {items.map((p, i) => (
              <div key={`${p}-${i}`} className="flex shrink-0 items-center gap-2 text-white/40 transition-colors hover:text-white/80">
                <span className="grid h-7 w-7 place-items-center rounded-md border border-white/15 bg-white/[0.04] text-xs font-bold">{p[0]}</span>
                <span className="whitespace-nowrap font-display text-sm font-semibold uppercase tracking-wider">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
