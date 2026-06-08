"use client";

import { Section, SectionHeading, Reveal, TrophyIcon } from "./Primitives";
import Link from "next/link";

const LEADERS = [
  { rank: 1, name: "VirenderS_92", country: "🇮🇳", points: 48720, won: "₹12,400", streak: 47, avatar: "from-amber-400 to-orange-500" },
  { rank: 2, name: "BoundaryKing", country: "🇦🇺", points: 46380, won: "₹9,800", streak: 38, avatar: "from-violet-500 to-pink-500" },
  { rank: 3, name: "YorkerQueen", country: "🇵🇰", points: 44210, won: "₹7,500", streak: 31, avatar: "from-emerald-400 to-cyan-500" },
  { rank: 4, name: "CricketPundit", country: "🇬🇧", points: 41980, won: "₹5,200", streak: 29, avatar: "from-rose-400 to-red-500" },
  { rank: 5, name: "SpinDoctor", country: "🇱🇰", points: 40150, won: "₹3,800", streak: 24, avatar: "from-blue-400 to-violet-500" },
];

const rankAccent = (rank: number) => {
  if (rank === 1) return "from-amber-300 via-amber-400 to-orange-500";
  if (rank === 2) return "from-slate-200 via-slate-300 to-slate-400";
  if (rank === 3) return "from-orange-300 via-orange-400 to-amber-600";
  return "from-white/20 to-white/10";
};

export default function Leaderboard() {
  return (
    <Section id="leaderboard" className="relative">
      <SectionHeading eyebrow="This week's champions" title={<>Compete with the <span className="text-gradient-trophy">best in the world.</span></>} description="Climb the ranks each week. The top 100 split a ₹50,000 prize pool every Sunday." />
      <Reveal delay={150}>
        <div className="mt-14 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent backdrop-blur-xl">
          <div className="hidden grid-cols-12 gap-4 border-b border-white/10 bg-white/[0.02] px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45 sm:grid">
            <div className="col-span-1">Rank</div>
            <div className="col-span-5">Player</div>
            <div className="col-span-2 text-right">Streak</div>
            <div className="col-span-2 text-right">Points</div>
            <div className="col-span-2 text-right">Won</div>
          </div>
          <ul>
            {LEADERS.map((p, i) => (
              <li key={p.name} className="group grid grid-cols-12 items-center gap-4 border-b border-white/[0.06] px-6 py-5 transition-colors hover:bg-white/[0.04] last:border-0" style={{ animation: `fade-up 0.6s ease-out ${i * 0.08}s both` }}>
                <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
                  <span className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br ${rankAccent(p.rank)} font-display text-sm font-bold text-ink-950 shadow-md`}>{p.rank <= 3 ? <TrophyIcon className="h-5 w-5" /> : p.rank}</span>
                </div>
                <div className="col-span-10 flex items-center gap-3 sm:col-span-5">
                  <div className={`relative grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${p.avatar} text-sm font-bold text-white shadow-inner`}>{p.name.slice(0, 2).toUpperCase()}{p.rank === 1 && <span className="absolute -top-2 -right-1 text-base">👑</span>}</div>
                  <div><p className="font-semibold text-white">{p.name} <span className="ml-1 text-base">{p.country}</span></p><p className="text-xs text-white/45">Lv. {Math.floor(p.points / 1000)}</p></div>
                </div>
                <div className="col-span-4 flex items-center justify-end gap-1 text-right sm:col-span-2"><span className="text-amber-400">🔥</span><span className="font-bold text-white">{p.streak}</span></div>
                <div className="col-span-4 text-right sm:col-span-2"><span className="font-display text-base font-bold tabular-nums text-white">{p.points.toLocaleString()}</span></div>
                <div className="col-span-4 text-right sm:col-span-2"><span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-bold text-emerald-300">{p.won}</span></div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-white/10 bg-white/[0.02] px-6 py-4">
            <p className="text-xs text-white/55">Updated <span className="text-white/80">live</span> · Resets every Sunday 00:00 IST</p>
            <Link href="/leaderboard" className="group inline-flex items-center gap-1 text-sm font-semibold text-emerald-400 hover:text-emerald-300">
              View full rankings<svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" fill="currentColor"><path d="M13.4 5.6 12 7l4 4H4v2h12l-4 4 1.4 1.4L20 12l-6.6-6.4Z" /></svg>
            </Link>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
