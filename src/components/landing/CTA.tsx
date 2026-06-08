"use client";

import { useAuth } from "@/contexts/AuthContext";
import { Section, Eyebrow, Reveal, Button } from "./Primitives";

export default function CTA() {
  const { user } = useAuth();
  const isLoggedIn = !!user;

  return (
    <Section id="cta" className="relative">
      <Reveal variant="scale">
        <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 p-10 sm:p-16 lg:p-20">
          <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: "radial-gradient(circle at 20% 30%, rgba(16,185,129,0.35), transparent 50%), radial-gradient(circle at 80% 70%, rgba(245,158,11,0.3), transparent 50%), radial-gradient(circle at 50% 100%, rgba(167,139,250,0.25), transparent 60%)" }} />
          <div className="absolute inset-0 bg-grid opacity-30" />
          <span className="absolute left-[6%] top-[14%] text-4xl opacity-50 anim-float">🏏</span>
          <span className="absolute right-[8%] top-[20%] text-3xl opacity-50 anim-float" style={{ animationDelay: "-3s" }}>🏆</span>
          <span className="absolute left-[10%] bottom-[18%] text-3xl opacity-40 anim-float" style={{ animationDelay: "-5s" }}>⚡</span>
          <span className="absolute right-[10%] bottom-[22%] text-3xl opacity-40 anim-float" style={{ animationDelay: "-2s" }}>🎯</span>
          <div className="relative mx-auto max-w-3xl text-center">
            <Eyebrow tone="trophy">Limited slots open</Eyebrow>
            <h2 className="mt-6 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">Ready to test your <span className="text-gradient-trophy">cricket knowledge?</span></h2>
            <p className="mx-auto mt-5 max-w-xl text-base text-white/65 sm:text-lg">Join thousands of cricket fans competing for amazing prizes. Your first quiz is on us — start your journey today.</p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button href={isLoggedIn ? "/quizzes" : "/register"} size="lg" variant="primary" icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M13.4 5.6 12 7l4 4H4v2h12l-4 4 1.4 1.4L20 12l-6.6-6.4Z" /></svg>}>
                {isLoggedIn ? "🚀 Play Now" : "🚀 Register Now"}
              </Button>
              <Button href={isLoggedIn ? "/quizzes" : "/register"} size="lg" variant="secondary">Try free demo</Button>
            </div>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-6">
              <div className="flex -space-x-2">
                {["from-rose-400 to-orange-500", "from-emerald-400 to-cyan-500", "from-violet-500 to-pink-500", "from-amber-400 to-orange-500", "from-blue-400 to-violet-500"].map((g, i) => (
                  <div key={i} className={`h-9 w-9 rounded-full bg-gradient-to-br ${g} ring-2 ring-ink-900`} />
                ))}
              </div>
              <p className="text-sm text-white/55"><span className="font-semibold text-white">2,184 players</span> joined this week</p>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
