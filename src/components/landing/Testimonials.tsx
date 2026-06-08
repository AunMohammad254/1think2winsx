"use client";

import { Section, SectionHeading, Reveal } from "./Primitives";

const REVIEWS = [
  { name: "Aarav Mehta", role: "Top 50 player · Mumbai", quote: "Won my first ₹2,000 within a week. The streak mechanic is addictive — feels like batting a perfect over every time you go on a roll.", avatar: "from-emerald-400 to-cyan-400", rating: 5 },
  { name: "Priya Iyer", role: "Weekly champion · Bengaluru", quote: "I've tried every cricket app out there. 1Think2Win is the only one with truly competitive players and real, instant payouts.", avatar: "from-violet-500 to-pink-500", rating: 5 },
  { name: "Rahul Verma", role: "Season finalist · Delhi", quote: "The UI is so smooth and the questions are genuinely tough. You can tell the team are real cricket fans — not just developers.", avatar: "from-amber-400 to-orange-500", rating: 5 },
  { name: "Saima Khan", role: "Daily player · Lucknow", quote: "I play during my coffee break. 60 seconds, real money, zero stress. Already won enough to cover my month's subscriptions.", avatar: "from-rose-400 to-red-500", rating: 5 },
  { name: "Dev Singh", role: "Pro tier · Chandigarh", quote: "The leaderboard pressure is real. I've made friends from Pakistan, Australia, even Sri Lanka — all united by our love of the game.", avatar: "from-blue-400 to-violet-500", rating: 5 },
];

function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5 text-amber-400">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${i < count ? "fill-amber-400" : "fill-white/15"}`} aria-hidden="true"><path d="m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7l3-7Z" /></svg>
      ))}
    </div>
  );
}

function ReviewCard({ r }: { r: (typeof REVIEWS)[number] }) {
  return (
    <article className="lift mx-2 w-[320px] shrink-0 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-6 backdrop-blur-xl sm:w-[360px]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br ${r.avatar} text-sm font-bold text-white`}>{r.name.split(" ").map((n) => n[0]).join("")}</div>
          <div><p className="font-semibold text-white">{r.name}</p><p className="text-xs text-white/45">{r.role}</p></div>
        </div>
        <Stars count={r.rating} />
      </div>
      <p className="mt-5 text-sm leading-relaxed text-white/75">"{r.quote}"</p>
    </article>
  );
}

export default function Testimonials() {
  const items = [...REVIEWS, ...REVIEWS];
  return (
    <Section id="reviews" className="relative overflow-hidden">
      <SectionHeading eyebrow="Player love" title={<>10,000+ players. <span className="text-gradient-cool">4.9 average rating.</span></>} description="Real reviews from real cricket fans who play — and win — every week." />
      <Reveal delay={150}>
        <div className="relative mt-14">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink-950 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink-950 to-transparent" />
          <div className="marquee-pause overflow-hidden">
            <div className="marquee-track">
              {items.map((r, i) => <ReviewCard key={`${r.name}-${i}`} r={r} />)}
            </div>
          </div>
        </div>
      </Reveal>
      <Reveal delay={300}>
        <div className="mt-14 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 text-center sm:gap-x-16">
          <div><p className="font-display text-3xl font-bold text-white">4.9★</p><p className="text-xs uppercase tracking-[0.16em] text-white/45">App rating</p></div>
          <div className="h-10 w-px bg-white/10" />
          <div><p className="font-display text-3xl font-bold text-white">10K+</p><p className="text-xs uppercase tracking-[0.16em] text-white/45">Reviews</p></div>
          <div className="h-10 w-px bg-white/10" />
          <div><p className="font-display text-3xl font-bold text-white">93%</p><p className="text-xs uppercase tracking-[0.16em] text-white/45">Recommend</p></div>
          <div className="h-10 w-px bg-white/10" />
          <div><p className="font-display text-3xl font-bold text-white">5min</p><p className="text-xs uppercase tracking-[0.16em] text-white/45">Avg payout</p></div>
        </div>
      </Reveal>
    </Section>
  );
}
