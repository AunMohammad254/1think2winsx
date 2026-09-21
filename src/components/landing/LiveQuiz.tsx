"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Section, Eyebrow, Reveal, Button, useScrollReveal, useAnimatedCounter } from "./Primitives";
import Link from "next/link";

const QUIZ_DATA = [
  { badge: "🏏 IPL Mega", title: "IPL 2025 — Ultimate Trivia", prize: 5000, players: 1284, timeLeft: "02h 14m", difficulty: "Pro", accent: "from-amber-400 to-orange-500" },
  { badge: "🌏 World Cup", title: "ODI World Cup Legends", prize: 2500, players: 892, timeLeft: "05h 41m", difficulty: "Intermediate", accent: "from-emerald-400 to-cyan-400" },
  { badge: "⚡ Daily", title: "60-Second Cricket Sprint", prize: 500, players: 3127, timeLeft: "Live now", difficulty: "Beginner", accent: "from-violet-400 to-pink-500" },
];

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "trophy" | "live" }) {
  const toneCls = tone === "trophy" ? "text-amber-300" : tone === "live" ? "text-red-300" : "text-white";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">{label}</p>
      <p className={`mt-1 font-display text-base font-bold ${toneCls}`}>{value}</p>
    </div>
  );
}

export default function LiveQuiz() {
  const { user } = useAuth();
  const isLoggedIn = !!user;
  const [active, setActive] = useState(0);
  const { ref, isVisible } = useScrollReveal({ threshold: 0.1, once: false });
  const carouselRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);
  const touchStartX = useRef(0);

  const livePlayers = useAnimatedCounter(QUIZ_DATA[active].players, 800);

  useEffect(() => {
    if (!isVisible) return;
    const id = setInterval(() => setActive((a) => (a + 1) % QUIZ_DATA.length), 5000);
    return () => clearInterval(id);
  }, [isVisible]);

  const handleDotClick = useCallback((i: number) => {
    setActive(i);
    carouselRef.current?.scrollTo({ left: i * (carouselRef.current.clientWidth), behavior: "smooth" });
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!carouselRef.current) return;
    setIsDragging(true);
    startX.current = e.pageX - carouselRef.current.offsetLeft;
    scrollLeft.current = carouselRef.current.scrollLeft;
  }, []);

  const onMouseUp = useCallback(() => {
    setIsDragging(false);
    if (!carouselRef.current) return;
    const idx = Math.round(carouselRef.current.scrollLeft / carouselRef.current.clientWidth);
    setActive(idx);
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !carouselRef.current) return;
      e.preventDefault();
      const x = e.pageX - carouselRef.current.offsetLeft;
      carouselRef.current.scrollLeft = scrollLeft.current - (x - startX.current) * 2;
    },
    [isDragging]
  );

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const diff = touchStartX.current - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) {
        const next = diff > 0 ? (active + 1) % QUIZ_DATA.length : (active - 1 + QUIZ_DATA.length) % QUIZ_DATA.length;
        setActive(next);
      }
    },
    [active]
  );

  return (
    <Section id="live" ref={ref as React.RefObject<HTMLDivElement>} className="relative overflow-hidden">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <div>
          <Reveal><Eyebrow tone="live">Live arena</Eyebrow></Reveal>
          <Reveal delay={100}>
            <h2 className="mt-5 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Jump into a <span className="text-gradient-pitch">live quiz</span> right now.
            </h2>
          </Reveal>
          <Reveal delay={200}>
            <p className="mt-5 text-lg text-white/65">New tournaments drop every hour. Pick your format, secure your spot, and battle real players for exciting physical prizes.</p>
          </Reveal>
          <Reveal delay={300}>
            <ul className="mt-8 space-y-3">
              {["10 questions, 60 seconds per round", "Streak multipliers up to 5×", "Instant UPI payouts to winners", "Free entry on daily challenges"].map((item, i) => (
                <li key={item} className="flex items-start gap-3 text-white/75" style={{ animation: `fade-up 0.5s ease-out ${0.4 + i * 0.1}s both` }}>
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="m10 16-4-4 1.4-1.4 2.6 2.6 5.6-5.6L17 9l-7 7Z" /></svg>
                  </span>
                  <span className="text-sm sm:text-base">{item}</span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={500}>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button href={isLoggedIn ? "/quizzes" : "/register"} size="lg" variant="primary">▶ Play live quiz</Button>
              <Button href="/quizzes#schedule" size="lg" variant="secondary">View schedule</Button>
            </div>
          </Reveal>
        </div>
        <div className="relative">
          <Reveal variant="scale" delay={200}>
            <div
              ref={carouselRef}
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseMove={onMouseMove}
              onMouseLeave={onMouseUp}
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
              className="flex snap-x snap-mandatory gap-6 overflow-x-auto scrollbar-none lg:overflow-hidden"
              style={{ cursor: isDragging ? "grabbing" : "grab" }}
            >
              {QUIZ_DATA.map((q, i) => (
                <div key={q.title} className="w-full shrink-0 snap-start lg:w-full">
                  <div className="glass relative overflow-hidden rounded-3xl p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] transition-all duration-500">
                    <div className={`pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full bg-gradient-to-br ${q.accent} opacity-25 blur-3xl transition-opacity duration-500`} />
                    <div className="relative">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white">{q.badge}</span>
                        {i === active && (
                          <span className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-red-300">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                            </span>
                            Live
                          </span>
                        )}
                      </div>
                      <h3 className="mt-5 font-display text-2xl font-bold text-white">{q.title}</h3>
                      <div className="mt-6 grid grid-cols-3 gap-3">
                        <Metric label="Prize pool" value={`₹${q.prize.toLocaleString()}`} tone="trophy" />
                        <Metric label="Players" value={i === active ? livePlayers.toLocaleString() : q.players.toLocaleString()} />
                        <Metric label="Starts in" value={q.timeLeft} tone={q.timeLeft === "Live now" ? "live" : "default"} />
                      </div>
                      <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-5">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/60">{q.difficulty}</span>
                          <span className="text-xs text-white/40">10 questions</span>
                        </div>
                        <Link
                          href={isLoggedIn ? "/quizzes" : "/register"}
                          className={`group/btn flex items-center gap-1.5 rounded-full bg-gradient-to-r ${q.accent} px-4 py-2 text-sm font-bold text-ink-950 shadow-lg transition-transform hover:scale-105`}
                        >
                          Join
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" fill="currentColor">
                            <path d="M13.4 5.6 12 7l4 4H4v2h12l-4 4 1.4 1.4L20 12l-6.6-6.4Z" />
                          </svg>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 flex justify-center gap-2">
              {QUIZ_DATA.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Show quiz ${i + 1}`}
                  onClick={() => handleDotClick(i)}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i === active ? "w-8 bg-emerald-400" : "w-1.5 bg-white/20 hover:bg-white/40"
                  }`}
                />
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
