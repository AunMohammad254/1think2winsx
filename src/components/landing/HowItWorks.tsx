"use client";

import { Section, SectionHeading, Reveal, Card } from "./Primitives";

const STEPS = [
  { n: "01", icon: "📝", title: "Create your account", desc: "Sign up in under 30 seconds. No credit card required — just your name, email and a passion for sports.", color: "from-emerald-400 to-cyan-400" },
  { n: "02", icon: "🎯", title: "Pick your quiz", desc: "Choose from live tournaments, daily challenges, or solo practice rooms across every sports format.", color: "from-violet-400 to-pink-400" },
  { n: "03", icon: "⚡", title: "Answer fast, score big", desc: "Speed matters. Faster correct answers earn streak multipliers — chain them to climb the leaderboard.", color: "from-amber-400 to-orange-500" },
  { n: "04", icon: "🎁", title: "Win & claim", desc: "Tech gadgets, gift cards, signed merchandise — winners can claim their favorite products instantly with their points.", color: "from-rose-400 to-red-500" },
];

const HIGHLIGHTS = [
  { icon: "⚡", title: "Lightning Quizzes", desc: "60-second adrenaline matches with instant scoring.", tag: "Real-time", gradient: "from-emerald-400/20 to-cyan-400/20" },
  { icon: "🌍", title: "Global Leaderboard", desc: "Climb the ranks against 10,000+ fans worldwide.", tag: "Competitive", gradient: "from-violet-400/20 to-pink-500/20" },
  { icon: "🔥", title: "Streaks & Combos", desc: "Stack correct answers for multiplier boosts up to 5x.", tag: "Bonus", gradient: "from-orange-400/20 to-red-500/20" },
];

export default function HowItWorks() {
  return (
    <Section  className="relative">
      <div className="absolute inset-0 -z-10 bg-dots opacity-30" />
      <SectionHeading
        eyebrow="Get started in 4 steps"
        title={<>From sign-up to <span className="text-gradient-trophy">payout in minutes.</span></>}
        description="A frictionless flow built for one thing: getting you into the game and rewarded fast."
      />
      <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <Reveal key={step.n} delay={i * 120} variant="up">
            <div className="group relative h-full">
              {i < STEPS.length - 1 && (
                <div className="pointer-events-none absolute left-full top-12 hidden h-px w-full -translate-x-4 lg:block">
                  <svg viewBox="0 0 100 4" className="h-1 w-full" preserveAspectRatio="none">
                    <line x1="0" y1="2" x2="100" y2="2" stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                  </svg>
                </div>
              )}
              <div className="lift relative h-full overflow-hidden rounded-2xl border border-white/10 bg-linear-to-b from-white/5 to-transparent p-6">
                <div className="flex items-start justify-between">
                  <span className={`bg-linear-to-br ${step.color} bg-clip-text font-display text-5xl font-bold text-transparent`}>
                    {step.n}
                  </span>
                  <span className="grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/5 text-2xl transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6">
                    {step.icon}
                  </span>
                </div>
                <h3 className="mt-6 font-display text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{step.desc}</p>
                <div className={`absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 bg-linear-to-r ${step.color} transition-transform duration-500 group-hover:scale-x-100`} />
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <div className="relative mt-20">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-linear-to-r from-transparent via-white/10 to-transparent" />
        <Reveal delay={200}>
          <p className="relative mb-10 text-center text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
            <span className="relative z-10 bg-ink-950 px-4">Everything you need to win</span>
          </p>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {HIGHLIGHTS.map((h, i) => (
            <Reveal key={h.title} delay={300 + i * 80} variant="up">
              <Card className="h-full text-center">
                <div className={`pointer-events-none absolute inset-0 bg-linear-to-br ${h.gradient} opacity-0 transition-opacity duration-500 group-hover:opacity-100`} />
                <div className="relative flex flex-col items-center">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-3xl ring-1 ring-white/10 transition-all duration-500 group-hover:scale-110 group-hover:rotate-6">
                    {h.icon}
                  </span>
                  <span className="mt-4 inline-block rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                    {h.tag}
                  </span>
                  <h3 className="mt-4 font-display text-lg font-semibold text-white">{h.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">{h.desc}</p>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
