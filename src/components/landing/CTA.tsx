"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Section, Eyebrow, Reveal, Button } from "./Primitives";

const WINNERS = [
  "Ali from Nazimabad won Ronin Earbuds",
  "Usman from Lahore won Smartwatch",
  "Bilal from Islamabad won Power Bank",
  "Saima from Karachi won Fitness Band",
  "Ayesha from Multan won Redmi Phone",
  "Hassan from Faisalabad won Sports Kit",
  "Zain from Rawalpindi won Wireless Mouse",
  "Fatima from Peshawar won Gaming Headset",
  "Omar from Quetta won Cricket Bat",
  "Sara from Sialkot won Bluetooth Speaker",
];

function Ticker() {
  const doubled = [...WINNERS, ...WINNERS];
  return (
    <div className="relative h-6 overflow-hidden">
      <div className="anim-ticker">
        {doubled.map((w, i) => (
          <div key={i} className="flex h-6 items-center gap-2 text-sm text-emerald-300/80">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>{w}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Countdown() {
  const getTarget = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next;
  };

  const calcDiff = () => {
    const diff = target.getTime() - Date.now();
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  };

  const [target] = useState(getTarget);
  const [display, setDisplay] = useState(calcDiff);

  useEffect(() => {
    const id = setInterval(() => setDisplay(calcDiff()), 1000);
    return () => clearInterval(id);
  });

  return <span className="font-mono font-bold text-amber-400">{display}</span>;
}

export default function CTA() {
  const { user } = useAuth();
  const isLoggedIn = !!user;

  return (
    <Section  className="relative">
      <Reveal variant="scale">
        <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 p-6 sm:p-10 md:p-16 lg:p-20">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(circle at 20% 30%, rgba(16,185,129,0.35), transparent 50%), radial-gradient(circle at 80% 70%, rgba(245,158,11,0.3), transparent 50%), radial-gradient(circle at 50% 100%, rgba(167,139,250,0.25), transparent 60%)",
            }}
          />
          <div className="absolute inset-0 bg-grid opacity-30" />
          <span className="absolute left-[6%] top-[14%] hidden text-4xl opacity-50 anim-float lg:block">🏏</span>
          <span className="absolute right-[8%] top-[20%] hidden text-3xl opacity-50 anim-float lg:block" style={{ animationDelay: "-3s" }}>🏆</span>
          <span className="absolute left-[10%] bottom-[18%] hidden text-3xl opacity-40 anim-float lg:block" style={{ animationDelay: "-5s" }}>⚡</span>
          <span className="absolute right-[10%] bottom-[22%] hidden text-3xl opacity-40 anim-float lg:block" style={{ animationDelay: "-2s" }}>🎯</span>

          <div className="relative mx-auto max-w-3xl text-center">
            <Ticker />
            <Eyebrow tone="trophy">Limited slots open</Eyebrow>
            <h2 className="mt-6 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl lg:text-6xl">
              Ready to test your <span className="text-gradient-trophy">sports knowledge?</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base text-white/65 sm:text-lg">
              Join thousands of sports fans competing for amazing prizes. Your first quiz is on us — start your journey today.
            </p>
            <div className="mt-8 flex items-center justify-center gap-2 text-sm text-white/55">
              <span>Next tournament starts in</span>
              <Countdown />
            </div>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                href={isLoggedIn ? "/quizzes" : "/register"}
                size="lg"
                variant="primary"
                icon={
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                    <path d="M13.4 5.6 12 7l4 4H4v2h12l-4 4 1.4 1.4L20 12l-6.6-6.4Z" />
                  </svg>
                }
              >
                {isLoggedIn ? "🚀 Play Now" : "🚀 Register Now"}
              </Button>
              <Button href={isLoggedIn ? "/quizzes" : "/register"} size="lg" variant="secondary">
                Try free demo
              </Button>
            </div>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-6">
              <div className="flex -space-x-2">
                {["from-rose-400 to-orange-500", "from-emerald-400 to-cyan-500", "from-violet-500 to-pink-500", "from-amber-400 to-orange-500", "from-blue-400 to-violet-500"].map(
                  (g, i) => (
                    <div key={i} className={`h-9 w-9 rounded-full bg-gradient-to-br ${g} ring-2 ring-ink-900 transition-transform duration-300 hover:scale-110`} />
                  )
                )}
              </div>
              <p className="text-sm text-white/55">
                <span className="font-semibold text-white">2,184 players</span> joined this week
              </p>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/35">
              <span>🔒 SSL Secure</span>
              <span>✅ PCI Compliant</span>
              <span>🛡️ 256-bit Encryption</span>
              <span>⚡ UPI Instant Pay</span>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
