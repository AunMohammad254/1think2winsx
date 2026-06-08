"use client";

import { useEffect, useState, useRef } from "react";
import { Section, SectionHeading, Reveal, TrophyIcon } from "./Primitives";
import Link from "next/link";

interface Player {
  rank: number;
  name: string;
  country: string;
  countryFlag: string;
  points: number;
  won: string;
  streak: number;
  avatar: string;
}

const BASE_LEADERS: Player[] = [
  { rank: 1, name: "VirenderS_92", country: "India", countryFlag: "🇮🇳", points: 48720, won: "₹12,400", streak: 47, avatar: "from-amber-400 to-orange-500" },
  { rank: 2, name: "BoundaryKing", country: "Australia", countryFlag: "🇦🇺", points: 46380, won: "₹9,800", streak: 38, avatar: "from-violet-500 to-pink-500" },
  { rank: 3, name: "YorkerQueen", country: "Pakistan", countryFlag: "🇵🇰", points: 44210, won: "₹7,500", streak: 31, avatar: "from-emerald-400 to-cyan-500" },
  { rank: 4, name: "CricketPundit", country: "UK", countryFlag: "🇬🇧", points: 41980, won: "₹5,200", streak: 29, avatar: "from-rose-400 to-red-500" },
  { rank: 5, name: "SpinDoctor", country: "Sri Lanka", countryFlag: "🇱🇰", points: 40150, won: "₹3,800", streak: 24, avatar: "from-blue-400 to-violet-500" },
];

function CountryFlag({ code }: { code: string }) {
  return <span className="inline-block text-base leading-none">{code}</span>;
}

const rankAccent = (rank: number) => {
  if (rank === 1) return "from-amber-300 via-amber-400 to-orange-500";
  if (rank === 2) return "from-slate-200 via-slate-300 to-slate-400";
  if (rank === 3) return "from-orange-300 via-orange-400 to-amber-600";
  return "from-white/20 to-white/10";
};

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function PlayerRow({ player, index }: { player: Player; index: number }) {
  const maxPoints = BASE_LEADERS[0].points;
  const progress = (player.points / maxPoints) * 100;
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setAnimate(true));
  }, []);

  return (
    <li
      className="group grid grid-cols-12 items-center gap-4 border-b border-white/[0.06] px-6 py-5 transition-all duration-500 hover:bg-white/[0.04] last:border-0"
      style={{
        animation: `fade-up 0.5s ease-out ${index * 0.06}s both`,
      }}
    >
      <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br ${rankAccent(
            player.rank
          )} font-display text-sm font-bold text-ink-950 shadow-md transition-transform duration-300 group-hover:scale-110`}
        >
          {player.rank <= 3 ? <TrophyIcon className="h-5 w-5" /> : player.rank}
        </span>
      </div>
      <div className="col-span-10 flex items-center gap-3 sm:col-span-5">
        <div
          className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br ${player.avatar} text-sm font-bold text-white shadow-inner transition-transform duration-300 group-hover:scale-105`}
        >
          {player.name.slice(0, 2).toUpperCase()}
          {player.rank === 1 && <span className="absolute -top-2 -right-1 text-base">👑</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">
            {player.name}{" "}
            <CountryFlag code={player.countryFlag} />
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${player.avatar} transition-all duration-1000 ease-out`}
              style={{ width: animate ? `${progress}%` : "0%" }}
            />
          </div>
        </div>
      </div>
      <div className="col-span-4 flex items-center justify-end gap-1 text-right sm:col-span-2">
        <span className="text-amber-400">🔥</span>
        <span className="font-bold text-white">{player.streak}</span>
      </div>
      <div className="col-span-4 text-right sm:col-span-2">
        <span className="font-display text-base font-bold tabular-nums text-white">
          {player.points.toLocaleString()}
        </span>
      </div>
      <div className="col-span-4 text-right sm:col-span-2">
        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-bold text-emerald-300">
          {player.won}
        </span>
      </div>
    </li>
  );
}

export default function Leaderboard() {
  const [leaders, setLeaders] = useState(BASE_LEADERS);

  useEffect(() => {
    const interval = setInterval(() => {
      setLeaders((prev) => {
        const shuffled = shuffleArray(prev);
        return shuffled.map((p, i) => ({ ...p, rank: i + 1 }));
      });
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Section id="leaderboard" className="relative">
      <SectionHeading
        eyebrow="This week's champions"
        title={<>Compete with the <span className="text-gradient-trophy">best in the world.</span></>}
        description="Climb the ranks each week. The top 100 split a ₹50,000 prize pool every Sunday."
      />
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
            {leaders.map((p, i) => (
              <PlayerRow key={p.name} player={p} index={i} />
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-white/10 bg-white/[0.02] px-6 py-4">
            <p className="text-xs text-white/55">
              Updated <span className="text-white/80">live</span> &middot; Resets every Sunday 00:00 IST
            </p>
            <Link
              href="/leaderboard"
              className="group inline-flex items-center gap-1 text-sm font-semibold text-emerald-400 hover:text-emerald-300"
            >
              View full rankings
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" fill="currentColor">
                <path d="M13.4 5.6 12 7l4 4H4v2h12l-4 4 1.4 1.4L20 12l-6.6-6.4Z" />
              </svg>
            </Link>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
