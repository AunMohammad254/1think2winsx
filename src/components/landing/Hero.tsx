"use client";

import { useMemo, useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Button,
  Reveal,
  Eyebrow,
  CricketBall,
  useTypewriter,
  useScrollReveal,
} from "./Primitives";

function Particles() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const particles = useMemo(() => {
    if (!mounted) return [];
    return Array.from({ length: 30 }).map((_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      size: Math.random() * 3 + 1.5,
      delay: Math.random() * 8,
      duration: Math.random() * 6 + 5,
    }));
  }, [mounted]);
  if (!mounted) return null;
  return (
    <div className="pointer-events-none absolute inset-0 -z-20 overflow-hidden" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute rounded-full bg-emerald-400/30 anim-particle"
          style={{
            left: p.left,
            top: p.top,
            width: p.size + "px",
            height: p.size + "px",
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

const SUBHEADS = ["Test your Cricket IQ", "Win real prizes", "Beat the world"];

function HeroVisual() {
  return (
    <div className="relative mx-auto max-w-md" style={{ backfaceVisibility: "hidden" }}>
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-emerald-500/30 via-amber-400/20 to-transparent blur-2xl" style={{ backfaceVisibility: "hidden" }} />
      <div className="absolute -top-12 -right-6 h-28 w-28 anim-float">
        <div className="anim-ball h-full w-full"><CricketBall className="h-full w-full" /></div>
      </div>
      <div className="absolute -bottom-6 -left-6 grid h-20 w-20 place-items-center rounded-2xl border border-amber-300/40 bg-gradient-to-br from-amber-300/30 to-orange-500/30 backdrop-blur-xl anim-float-soft glow-trophy" style={{ backfaceVisibility: "hidden" }}>
        <span className="text-3xl">🏆</span>
      </div>
      <div className="glass relative rounded-3xl p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-pulse" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-red-300">Live &bull; Q 4 of 10</span>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-bold text-amber-300">🔥 12 streak</div>
        </div>
        <div className="mb-5 flex items-center gap-4">
          <div className="relative h-14 w-14">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle cx="18" cy="18" r="16" stroke="rgba(255,255,255,0.1)" strokeWidth="3" fill="none" />
              <circle cx="18" cy="18" r="16" stroke="url(#timer-grad)" strokeWidth="3" fill="none" strokeDasharray="100" strokeDashoffset="35" strokeLinecap="round" className="animate-pulse" style={{ animationDuration: "2s" }} />
              <defs><linearGradient id="timer-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#34d399" /><stop offset="100%" stopColor="#fbbf24" /></linearGradient></defs>
            </svg>
            <span className="absolute inset-0 grid place-items-center text-sm font-bold text-white">18s</span>
          </div>
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Question</p>
            <p className="mt-0.5 text-base font-semibold text-white">Who scored the fastest T20I century?</p>
          </div>
        </div>
        <div className="space-y-2.5">
          {[
            { letter: "A", text: "Rohit Sharma", state: "idle" },
            { letter: "B", text: "David Miller", state: "correct" },
            { letter: "C", text: "Chris Gayle", state: "idle" },
            { letter: "D", text: "Suryakumar Yadav", state: "idle" },
          ].map((opt, i) => (
            <div
              key={opt.letter}
              className={`group flex items-center gap-3 rounded-xl border px-4 py-3 transition-[transform,opacity,border-color,background-color] duration-300 ${
                opt.state === "correct"
                  ? "border-emerald-400/60 bg-emerald-500/10"
                  : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.08]"
              }`}
              style={{ animation: `fade-up 0.5s ease-out ${0.15 + i * 0.1}s both` }}
            >
              <span
                className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-bold transition-all duration-300 ${
                  opt.state === "correct"
                    ? "bg-emerald-400 text-ink-950 scale-110"
                    : "bg-white/10 text-white/70"
                }`}
              >
                {opt.letter}
              </span>
              <span className="flex-1 text-sm font-medium text-white">{opt.text}</span>
              {opt.state === "correct" && (
                <span className="text-emerald-400 animate-success-scale">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                    <path d="m10 16-4-4 1.4-1.4 2.6 2.6 5.6-5.6L17 9l-7 7Z" />
                  </svg>
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-xs">
          <div className="flex items-center gap-1.5 text-white/55">
            <span className="text-amber-400">🪙</span>
            <span className="font-semibold text-white">+250 pts</span>
            <span>per correct</span>
          </div>
          <div className="flex -space-x-2">
            {["from-rose-400 to-orange-500", "from-emerald-400 to-cyan-500", "from-violet-500 to-pink-500"].map((g, i) => (
              <div key={i} className={`h-6 w-6 rounded-full bg-gradient-to-br ${g} ring-2 ring-ink-900 transition-transform duration-300 hover:scale-110`} />
            ))}
            <div className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-[10px] font-bold text-white ring-2 ring-ink-900">+9</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Hero() {
  const { user, isLoading } = useAuth();
  const isLoggedIn = !!user;
  const typedText = useTypewriter(SUBHEADS, { typeSpeed: 50, deleteSpeed: 30, pause: 2200 });

  const ctaConfig = useMemo(() => {
    if (isLoading) return { href: "/quizzes", text: "Start Quiz Now", icon: "🎯" };
    if (isLoggedIn) return { href: "/quizzes", text: "Play Now", icon: "🚀" };
    return { href: "/register", text: "Play Free Now", icon: "🚀" };
  }, [isLoading, isLoggedIn]);

  const { ref: heroRef, isVisible } = useScrollReveal<HTMLDivElement>({ once: true, threshold: 0.05 });

  return (
    <section id="top" ref={heroRef} className="relative isolate contain-paint flex min-h-[90svh] items-center overflow-hidden pt-12 pb-20">
      <div className="absolute inset-0 -z-20 bg-gradient-to-b from-ink-950 via-ink-900 to-ink-950" />
      <div className="absolute inset-0 -z-20 bg-grid opacity-60" />
      <Particles />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-20 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-[120px] anim-orb" />
        <div className="absolute bottom-0 right-1/4 h-[26rem] w-[26rem] rounded-full bg-amber-400/15 blur-[100px] anim-orb" style={{ animationDelay: "-7s" }} />
        <div className="absolute top-1/3 left-1/4 h-[20rem] w-[20rem] rounded-full bg-violet-500/15 blur-[100px] anim-orb" style={{ animationDelay: "-12s" }} />
      </div>
      <div className="pointer-events-none absolute inset-0 -z-10">
        <span className="absolute left-[6%] top-[18%] text-4xl opacity-40 anim-float">🏆</span>
        <span className="absolute right-[8%] top-[24%] text-3xl opacity-40 anim-float" style={{ animationDelay: "-2s" }}>🎯</span>
        <span className="absolute left-[12%] bottom-[18%] text-3xl opacity-30 anim-float" style={{ animationDelay: "-4s" }}>⚡</span>
        <span className="absolute right-[14%] bottom-[22%] text-4xl opacity-40 anim-float" style={{ animationDelay: "-3s" }}>🌟</span>
        <span className="absolute left-[40%] top-[10%] text-2xl opacity-30 anim-float" style={{ animationDelay: "-5s" }}>🎮</span>
      </div>
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-7">
          <Reveal><Eyebrow tone="live">Live quizzes available</Eyebrow></Reveal>
          <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl xl:text-[5.5rem]">
            <span className={`block transition-all duration-700 ${isVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
              {typedText}
              <span className="ml-0.5 inline-block h-[0.08em] w-[3px] rounded bg-emerald-400 align-middle anim-cursor" />
            </span>
            <span className={`block text-gradient-pitch transition-all duration-700 delay-150 ${isVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
              & win <span className="text-gradient-trophy">real prizes.</span>
            </span>
          </h1>
          <Reveal delay={500}>
            <p className="mt-6 max-w-xl text-lg text-white/65 sm:text-xl">
              Compete with fans worldwide, climb the global leaderboard, and unlock exclusive rewards — all in under <span className="text-white">60 seconds</span>.
            </p>
          </Reveal>
          <Reveal delay={700}>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button href={ctaConfig.href} size="lg" variant="primary" icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M13.4 5.6 12 7l4 4H4v2h12l-4 4 1.4 1.4L20 12l-6.6-6.4Z" /></svg>}>
                {ctaConfig.text}
              </Button>
              <Button href="#how" size="lg" variant="secondary">See how it works</Button>
            </div>
          </Reveal>
          <Reveal delay={900}>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 text-sm text-white/55">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="m10 16-4-4 1.4-1.4 2.6 2.6 5.6-5.6L17 9l-7 7Z" /></svg>
                </span>
                <span>No credit card</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="m10 16-4-4 1.4-1.4 2.6 2.6 5.6-5.6L17 9l-7 7Z" /></svg>
                </span>
                <span>Instant payouts</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="m10 16-4-4 1.4-1.4 2.6 2.6 5.6-5.6L17 9l-7 7Z" /></svg>
                </span>
                <span>Verified by 10,000+ players</span>
              </div>
            </div>
          </Reveal>
        </div>
        <div className="lg:col-span-5">
          <Reveal variant="scale" delay={400}><HeroVisual /></Reveal>
        </div>
      </div>
      <a href="#stats" aria-label="Scroll down" className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-white/40 transition-colors hover:text-white sm:flex">
        <span className="text-[10px] uppercase tracking-[0.3em]">Scroll</span>
        <span className="relative grid h-9 w-5 place-items-start overflow-hidden rounded-full border border-white/20 p-1">
          <span className="block h-1.5 w-1.5 rounded-full bg-white/70 anim-bounce-soft" />
        </span>
      </a>
    </section>
  );
}
