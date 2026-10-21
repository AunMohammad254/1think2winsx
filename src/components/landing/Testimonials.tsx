"use client";

import { useState, useEffect, memo } from "react";
import { Section, SectionHeading, Reveal } from "./Primitives";

const REVIEWS = [
  { name: "Hamza Siddiqui", role: "Top 50 player · Gulshan-e-Iqbal, Karachi", quote: "Won my first prize within a week. The streak mechanic is addictive — feels like batting a perfect over every time you go on a roll.", avatar: "from-emerald-400 to-cyan-400", rating: 5 },
  { name: "Areeba Khan", role: "Weekly champion · DHA, Karachi", quote: "I've tried every sports app out there. 1Think2Win is the only one with truly competitive players and real, instant prizes.", avatar: "from-violet-500 to-pink-500", rating: 5 },
  { name: "Faizan Qureshi", role: "Season finalist · Lahore", quote: "The UI is so smooth and the questions are genuinely tough. You can tell the team are real sports fans — not just developers.", avatar: "from-amber-400 to-orange-500", rating: 5 },
  { name: "Saima Khan", role: "Daily player · North Nazimabad, Karachi", quote: "I play during my coffee break. 60 seconds, random prizes, zero stress. Already won an amazing smartwatch!", avatar: "from-rose-400 to-red-500", rating: 5 },
  { name: "Danish Baloch", role: "Pro tier · Lyari, Karachi", quote: "The leaderboard pressure is real. I've made friends from Lahore, Peshawar, even Gilgit — all united by our love of the game.", avatar: "from-blue-400 to-violet-500", rating: 5 },
];

// One filled star per rating point (every review is currently rated 5)
function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5 text-amber-400">
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-amber-400" aria-hidden="true">
          <path d="m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7l3-7Z" />
        </svg>
      ))}
    </div>
  );
}

const ReviewCard = memo(function ReviewCard({ r, index }: { r: (typeof REVIEWS)[number]; index: number }) {
  const onMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(1000px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateZ(10px)`;
  };

  const onMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.transform = "perspective(1000px) rotateY(0deg) rotateX(0deg) translateZ(0)";
  };

  return (
    <article
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className="lift mx-2 w-[320px] shrink-0 rounded-2xl border border-white/10 bg-linear-to-b from-white/8 to-white/3 p-6 transition-all duration-200 sm:w-90"
      style={{ animation: `fade-up 0.5s ease-out ${index * 0.08}s both` }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`grid h-10 w-10 place-items-center rounded-full bg-linear-to-br ${r.avatar} text-sm font-bold text-white`}>
            {r.name.split(" ").map((n) => n[0]).join("")}
          </div>
          <div>
            <p className="font-semibold text-white">{r.name}</p>
            <p className="text-xs text-white/60">{r.role}</p>
          </div>
        </div>
        <Stars count={r.rating} />
      </div>
      <p className="mt-5 text-sm leading-relaxed text-white/75">"{r.quote}"</p>
    </article>
  );
});

// ⚡ Bolt Performance Optimization:
// Extracted `spotlightIndex` state and its `setInterval` into a separate `FeaturedReview` component.
// Why: Prevents the large outer `Testimonials` component (with its static grid and marquee) from
// re-rendering every 4 seconds.
// Impact: Eliminates periodic deep reconciliation of static child components during the spotlight loop.
function FeaturedReview() {
  const [spotlightIndex, setSpotlightIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setSpotlightIndex((i) => (i + 1) % REVIEWS.length);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const spotlight = REVIEWS[spotlightIndex];

  return (
    <div className="mx-auto mt-14 max-w-md">
      <div className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-linear-to-br from-emerald-500/8 to-amber-400/5 p-6 transition-all duration-700">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Featured review
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-linear-to-br ${spotlight.avatar} text-sm font-bold text-white`}>
            {spotlight.name.split(" ").map((n) => n[0]).join("")}
          </div>
          <div>
            <p className="font-semibold text-white">{spotlight.name}</p>
            <p className="text-xs text-white/60">{spotlight.role}</p>
          </div>
          <div className="ml-auto"><Stars count={spotlight.rating} /></div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/75">"{spotlight.quote}"</p>
      </div>
    </div>
  );
}

export default function Testimonials() {
  const items = [...REVIEWS, ...REVIEWS];

  return (
    <Section  className="relative overflow-hidden">
      <SectionHeading
        eyebrow="Player love"
        title={<>10,000+ players. <span className="text-gradient-cool">4.9 average rating.</span></>}
        description="Real reviews from real sports fans who play — and win — every week."
      />
      <Reveal delay={150}>
        <div className="relative mt-14">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-linear-to-r from-ink-950 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-linear-to-l from-ink-950 to-transparent" />
          <div className="marquee-pause overflow-hidden">
            <div className="marquee-track" style={{ animationDuration: "30s" }}>
              {items.map((r, i) => (
                <ReviewCard key={`${r.name}-${i}`} r={r} index={i} />
              ))}
            </div>
          </div>
        </div>
      </Reveal>
      <Reveal delay={300}>
        <div className="mt-14 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 text-center sm:gap-x-16">
          <div>
            <p className="font-display text-3xl font-bold text-white">4.9★</p>
            <p className="text-xs uppercase tracking-[0.16em] text-white/60">App rating</p>
          </div>
          <div className="h-10 w-px bg-white/10" />
          <div>
            <p className="font-display text-3xl font-bold text-white">10K+</p>
            <p className="text-xs uppercase tracking-[0.16em] text-white/60">Reviews</p>
          </div>
          <div className="h-10 w-px bg-white/10" />
          <div>
            <p className="font-display text-3xl font-bold text-white">93%</p>
            <p className="text-xs uppercase tracking-[0.16em] text-white/60">Recommend</p>
          </div>
          <div className="h-10 w-px bg-white/10" />
          <div>
            <p className="font-display text-3xl font-bold text-white">5min</p>
            <p className="text-xs uppercase tracking-[0.16em] text-white/60">Avg payout</p>
          </div>
        </div>
      </Reveal>
      <Reveal delay={450}>
        <FeaturedReview />
      </Reveal>
    </Section>
  );
}
