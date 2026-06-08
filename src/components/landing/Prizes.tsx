"use client";

import { useAuth } from "@/contexts/AuthContext";
import { Section, SectionHeading, Reveal, Button } from "./Primitives";

const TIERS = [
  { name: "Daily Win", emoji: "⚡", amount: "₹100 – ₹500", desc: "Quick daily quizzes with instant payouts to your UPI. Free entry — play anytime.", perks: ["Free entry", "Instant payout", "60-second rounds"], accent: "from-emerald-400 to-cyan-400", border: "border-emerald-400/30", glow: "shadow-[0_30px_80px_-30px_rgba(16,185,129,0.5)]", badge: null },
  { name: "Weekly Mega", emoji: "🏆", amount: "₹5,000 – ₹20,000", desc: "Multi-round weekend tournaments with leaderboards, eliminations and grand finals.", perks: ["Top 100 paid", "Bracket play", "Exclusive merch"], accent: "from-amber-400 to-orange-500", border: "border-amber-400/50", glow: "shadow-[0_30px_100px_-20px_rgba(245,158,11,0.55)]", badge: "Most popular" },
  { name: "Season Champion", emoji: "👑", amount: "₹50,000 +", desc: "Three-month leagues for the elite. Sponsored prizes, signed gear and travel rewards.", perks: ["Signed merchandise", "Travel rewards", "VIP support"], accent: "from-violet-400 to-pink-500", border: "border-violet-400/30", glow: "shadow-[0_30px_80px_-30px_rgba(167,139,250,0.5)]", badge: null },
];

export default function Prizes() {
  const { user } = useAuth();
  const isLoggedIn = !!user;

  return (
    <Section id="prizes" className="relative">
      <div className="absolute inset-0 -z-10 bg-grid opacity-40" />
      <SectionHeading eyebrow="Prize pools" title={<>Real rewards for <span className="text-gradient-trophy">real cricket smarts.</span></>} description="Whether you play casually or aim for the season crown — there's a prize tier built for you." />
      <div className="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {TIERS.map((tier, i) => (
          <Reveal key={tier.name} delay={i * 120} variant="up">
            <div className={`group relative h-full overflow-hidden rounded-3xl border ${tier.border} bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-8 backdrop-blur-xl lift ${tier.badge ? `${tier.glow} lg:scale-105` : ""}`}>
              <div className={`pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-gradient-to-br ${tier.accent} opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-50`} />
              {tier.badge && <div className="absolute right-5 top-5"><span className="rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-950 shadow-lg">{tier.badge}</span></div>}
              <div className="relative">
                <span className="inline-block text-5xl transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6">{tier.emoji}</span>
                <h3 className="mt-5 font-display text-xl font-bold text-white">{tier.name}</h3>
                <p className={`mt-2 bg-gradient-to-r ${tier.accent} bg-clip-text font-display text-3xl font-bold text-transparent sm:text-4xl`}>{tier.amount}</p>
                <p className="mt-3 text-sm leading-relaxed text-white/60">{tier.desc}</p>
                <ul className="mt-6 space-y-2.5">
                  {tier.perks.map((perk) => (
                    <li key={perk} className="flex items-center gap-2.5 text-sm text-white/75">
                      <span className={`grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br ${tier.accent} text-ink-950`}><svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="m10 16-4-4 1.4-1.4 2.6 2.6 5.6-5.6L17 9l-7 7Z" /></svg></span>{perk}
                    </li>
                  ))}
                </ul>
                <div className="mt-8"><Button href={isLoggedIn ? "/quizzes" : "/register"} variant={tier.badge ? "trophy" : "secondary"} className="w-full">Enter {tier.name.split(" ")[0]}</Button></div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={400}><div className="mt-16 flex flex-col items-center justify-center gap-3 text-center"><p className="text-sm text-white/45">🔒 Secure payouts powered by <span className="font-semibold text-white">UPI</span> · <span className="font-semibold text-white">Stripe</span> · <span className="font-semibold text-white">Razorpay</span></p></div></Reveal>
    </Section>
  );
}
