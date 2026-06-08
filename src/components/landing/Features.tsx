"use client";

import { Section, SectionHeading, Reveal, Card } from "./Primitives";

const FEATURES = [
  { icon: "⚡", title: "Lightning Quizzes", desc: "60-second adrenaline matches with instant scoring. Skill, speed, and a sharp cricket eye decide your fate.", tag: "Real-time", gradient: "from-emerald-400/20 to-cyan-400/20" },
  { icon: "🏆", title: "Real Cash Prizes", desc: "From ₹100 daily wins to ₹50K monthly mega tournaments. Withdrawals hit your UPI within minutes.", tag: "Win Big", gradient: "from-amber-400/20 to-orange-500/20" },
  { icon: "🌍", title: "Global Leaderboard", desc: "Climb the ranks against 10,000+ fans worldwide. Weekly and seasonal standings reset for everyone.", tag: "Competitive", gradient: "from-violet-400/20 to-pink-500/20" },
  { icon: "🎯", title: "All Cricket Formats", desc: "T20, ODI, Test, IPL, World Cup history — pick your favorite format or master them all.", tag: "500+ Quizzes", gradient: "from-rose-400/20 to-amber-400/20" },
  { icon: "🔥", title: "Streaks & Combos", desc: "Stack correct answers for multiplier boosts. The hotter your streak, the bigger your reward.", tag: "Bonus", gradient: "from-orange-400/20 to-red-500/20" },
  { icon: "🛡️", title: "Provably Fair", desc: "Every question is verified, every prize transparent. Audited algorithms keep the game honest.", tag: "Trusted", gradient: "from-blue-400/20 to-violet-500/20" },
];

export default function Features() {
  return (
    <Section id="features">
      <SectionHeading eyebrow="Why players love it" title={<>Built for the <span className="text-gradient-pitch">true cricket fan.</span></>} description="Every feature is engineered to make you think faster, win smarter, and have a blast doing it." />
      <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, i) => (
          <Reveal key={feature.title} delay={i * 80} variant="up">
            <Card className="h-full">
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 transition-opacity duration-500 group-hover:opacity-100`} />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/5 text-2xl ring-1 ring-white/10 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6">{feature.icon}</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">{feature.tag}</span>
                </div>
                <h3 className="mt-5 font-display text-xl font-semibold text-white">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{feature.desc}</p>
                <div className="mt-5 flex items-center gap-1 text-xs font-medium text-emerald-400 opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-1">
                  Learn more<svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="M13.4 5.6 12 7l4 4H4v2h12l-4 4 1.4 1.4L20 12l-6.6-6.4Z" /></svg>
                </div>
              </div>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
