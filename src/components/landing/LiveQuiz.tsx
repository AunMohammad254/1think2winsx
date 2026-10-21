"use client";

import { memo, useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Section, Eyebrow, Reveal, Button, useScrollReveal, useAnimatedCounter } from "./Primitives";
import Link from "next/link";
import { useLiveSnapshot } from "@/hooks/useLiveSnapshot";
import { useNow } from "@/hooks/useNow";
import { toLandingQuizzes, formatCountdown, type LandingQuiz } from "@/lib/landing-live";
import { formatBusinessStart } from "@/lib/schedule-time";

// Shown while the real quiz list loads and when it cannot be loaded, so the section never looks broken
const QUIZ_DATA = [
  { badge: "🏏 PSL Mega", title: "Karachi Kings — PSL Ultimate Trivia", prize: 5000, players: 1284, timeLeft: "02h 14m", difficulty: "Pro", accent: "from-amber-400 to-orange-500" },
  { badge: "🏆 Domestic", title: "National T20 Cup & Quaid-e-Azam Trophy", prize: 2500, players: 892, timeLeft: "05h 41m", difficulty: "Intermediate", accent: "from-emerald-400 to-cyan-400" },
  { badge: "⚡ Daily", title: "60-Second Sprint: Hockey, Squash & Snooker", prize: 500, players: 3127, timeLeft: "Live now", difficulty: "Beginner", accent: "from-violet-400 to-pink-500" },
];

type Tone = "default" | "trophy" | "live";
type Pill = "live" | "open" | "upcoming" | null;

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: Tone }) {
  const toneCls = tone === "trophy" ? "text-amber-300" : tone === "live" ? "text-red-300" : "text-white";
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/60">{label}</p>
      <p className={`mt-1 font-display text-base font-bold wrap-break-word ${toneCls}`}>{value}</p>
    </div>
  );
}

function StatePill({ pill }: { pill: Pill }) {
  if (pill === "live") {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-red-300">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
        </span>
        Live
      </span>
    );
  }
  if (pill === "open") {
    return <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-300">Open</span>;
  }
  if (pill === "upcoming") {
    return <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-300">Upcoming</span>;
  }
  return null;
}

function CardShell({ accent, badge, pill, title, when, tag, detail, href, children }: {
  accent: string;
  badge: string;
  pill: Pill;
  title: string;
  when?: string;
  tag: string;
  detail: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <div className="w-full shrink-0 snap-start lg:w-full">
      <div className="glass relative overflow-hidden rounded-3xl p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] transition-all duration-500">
        <div className={`pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full bg-linear-to-br ${accent} opacity-25 blur-3xl transition-opacity duration-500`} />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white">{badge}</span>
            <StatePill pill={pill} />
          </div>
          <h3 className="mt-5 font-display text-2xl font-bold text-white">{title}</h3>
          {/* Always takes its line, so the card keeps its height when real quizzes replace the demo */}
          <p className="mt-2 min-h-5 text-sm text-white/60">{when}</p>
          <div className="mt-6 grid grid-cols-3 gap-3">{children}</div>
          <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-5">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/60">{tag}</span>
              <span className="text-xs text-white/60">{detail}</span>
            </div>
            <Link
              href={href}
              className={`group/btn flex items-center gap-1.5 rounded-full bg-linear-to-r ${accent} px-4 py-2 text-sm font-bold text-ink-950 shadow-lg transition-transform hover:scale-105`}
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
  );
}

// Memoized: the carousel re-renders on every carousel tick and animated-counter frame, but only the
// card whose props change (the active one, which alone gets the live player count) needs to.
const QuizCarouselCard = memo(function QuizCarouselCard({
  q,
  isActive,
  livePlayers,
  isLoggedIn
}: {
  q: typeof QUIZ_DATA[0];
  isActive: boolean;
  livePlayers: number;
  isLoggedIn: boolean;
}) {
  return (
    <CardShell accent={q.accent} badge={q.badge} pill={isActive ? "live" : null} title={q.title} tag={q.difficulty} detail="10 questions" href={isLoggedIn ? "/quizzes" : "/register"}>
      <Metric label="Prize pool" value={`${q.prize.toLocaleString()} PKR`} tone="trophy" />
      <Metric label="Players" value={livePlayers.toLocaleString()} />
      <Metric label="Starts in" value={q.timeLeft} tone={q.timeLeft === "Live now" ? "live" : "default"} />
    </CardShell>
  );
});

/** The third metric and the line under the title, from the quiz's state and the clock. */
function timing(quiz: LandingQuiz, now: number): { label: string; value: string; tone: Tone; when?: string } {
  const at = (ms: number) => formatBusinessStart(new Date(ms), new Date(now));
  if (quiz.state === "live") {
    return { label: "Ends in", value: formatCountdown(quiz.endsAtMs! - now), tone: "live", when: `Closes · ${at(quiz.endsAtMs!)}` };
  }
  if (quiz.state === "open") return { label: "Starts", value: "Open now", tone: "live", when: "Open any time" };
  if (quiz.startsAtMs === null) return { label: "Starts", value: "Soon", tone: "default" };
  // Past its start time but not live yet: the server makes it live on its next catalogue read
  if (quiz.startsAtMs <= now) return { label: "Starts", value: "Any moment", tone: "live", when: `Starts · ${at(quiz.startsAtMs)}` };
  return { label: "Starts in", value: formatCountdown(quiz.startsAtMs - now), tone: "default", when: `Starts · ${at(quiz.startsAtMs)}` };
}

// Memoized like the demo cards: only the clock (once a second) re-renders them, not carousel frames
const RealQuizCard = memo(function RealQuizCard({
  quiz,
  now,
  accent,
  isLoggedIn,
}: {
  quiz: LandingQuiz;
  now: number;
  accent: string;
  isLoggedIn: boolean;
}) {
  const t = timing(quiz, now);
  const badge = quiz.isBumperPrize ? "🎁 Bumper prize" : quiz.hasPrize ? "🏆 Prize quiz" : "⚡ Quiz";
  const questions = `${quiz.questionCount} ${quiz.questionCount === 1 ? "question" : "questions"}`;
  const played = quiz.totalAttempts > 0 ? ` · ${quiz.totalAttempts.toLocaleString()} played` : "";
  return (
    <CardShell accent={accent} badge={badge} pill={quiz.state} title={quiz.title} when={t.when} tag={`${quiz.duration} min`} detail={questions + played} href={isLoggedIn ? "/quizzes" : "/register"}>
      <Metric label="Prize" value={quiz.prize} tone="trophy" />
      <Metric label="Entry" value={quiz.entry} />
      <Metric label={t.label} value={t.value} tone={t.tone} />
    </CardShell>
  );
});

function EmptyCard({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <div className="glass relative overflow-hidden rounded-3xl p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
      <div className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full bg-linear-to-br from-emerald-400 to-cyan-400 opacity-25 blur-3xl" />
      <div className="relative">
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white">📅 Schedule</span>
        <h3 className="mt-5 font-display text-2xl font-bold text-white">No quiz is live right now</h3>
        <p className="mt-3 text-sm text-white/65">
          The next quiz hasn&apos;t been scheduled yet. New quizzes are announced on the quizzes page and in players&apos; notifications.
        </p>
        <div className="mt-6 flex justify-end border-t border-white/10 pt-5">
          <Link
            href={isLoggedIn ? "/quizzes" : "/register"}
            className="rounded-full bg-linear-to-r from-emerald-400 to-cyan-400 px-4 py-2 text-sm font-bold text-ink-950 shadow-lg transition-transform hover:scale-105"
          >
            {isLoggedIn ? "See quizzes" : "Sign up free"}
          </Link>
        </div>
      </div>
    </div>
  );
}

// Memoized: the section re-renders every second (clock) and on every animated-counter frame, but this
// column only changes with the sign-in state, so React can skip reconciling it.
const LiveQuizIntro = memo(function LiveQuizIntro({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
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
          {["10 questions, 60 seconds per round", "Streak multipliers up to 5×", "Prizes delivered anywhere in Pakistan", "Free entry on daily challenges"].map((item, i) => (
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
  );
});

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

  // Real quizzes once the cached snapshot arrives; until then (or if it fails) the demo cards stay
  const { snapshot } = useLiveSnapshot();
  const now = useNow(1000, snapshot !== null);
  const quizzes = useMemo(() => (snapshot ? toLandingQuizzes(snapshot, now) : null), [snapshot, now]);
  const count = quizzes ? quizzes.length : QUIZ_DATA.length;
  // The list can shrink under the selection (a quiz closes, or real data replaces the demo)
  const current = Math.min(active, Math.max(count - 1, 0));

  // Only the demo cards count players up; a target of 0 leaves the counter idle
  const livePlayers = useAnimatedCounter(quizzes ? 0 : QUIZ_DATA[current].players, 800);

  useEffect(() => {
    // No auto-advance for reduced motion: the dots and swipes still switch cards (WCAG 2.2.2)
    if (!isVisible || count < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setActive((a) => (Math.min(a, count - 1) + 1) % count), 5000);
    return () => clearInterval(id);
  }, [isVisible, count]);

  const handleDotClick = useCallback((i: number) => {
    setActive(i);
    carouselRef.current?.scrollTo({ left: i * (carouselRef.current.clientWidth), behavior: "smooth" });
  }, []);

  // The mouse handlers sit on the carousel itself, so carouselRef is set whenever they run
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const carousel = carouselRef.current!;
    setIsDragging(true);
    startX.current = e.pageX - carousel.offsetLeft;
    scrollLeft.current = carousel.scrollLeft;
  }, []);

  const onMouseUp = useCallback(() => {
    setIsDragging(false);
    const carousel = carouselRef.current!;
    const idx = Math.round(carousel.scrollLeft / carousel.clientWidth);
    setActive(idx);
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      const carousel = carouselRef.current!;
      const x = e.pageX - carousel.offsetLeft;
      carousel.scrollLeft = scrollLeft.current - (x - startX.current) * 2;
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
        const next = diff > 0 ? (current + 1) % count : (current - 1 + count) % count;
        setActive(next);
      }
    },
    [current, count]
  );

  return (
    <Section  ref={ref as React.RefObject<HTMLDivElement>} className="relative overflow-hidden">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <LiveQuizIntro isLoggedIn={isLoggedIn} />
        <div className="relative">
          <Reveal variant="scale" delay={200}>
            {count === 0 ? (
              <EmptyCard isLoggedIn={isLoggedIn} />
            ) : (
              <>
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
                  {quizzes
                    ? quizzes.map((quiz, i) => (
                        <RealQuizCard key={quiz.id} quiz={quiz} now={now} accent={QUIZ_DATA[i % QUIZ_DATA.length].accent} isLoggedIn={isLoggedIn} />
                      ))
                    : QUIZ_DATA.map((q, i) => (
                        <QuizCarouselCard
                          key={q.title}
                          q={q}
                          isActive={i === current}
                          livePlayers={i === current ? livePlayers : q.players}
                          isLoggedIn={isLoggedIn}
                        />
                      ))}
                </div>
                {count > 1 && (
                  <div className="mt-8 flex justify-center gap-[18px]">
                    {Array.from({ length: count }, (_, i) => (
                      // The ::after box turns each 6px dot into a 24px tap target (WCAG 2.5.8) without changing its look
                      <button
                        key={i}
                        aria-label={`Show quiz ${i + 1}`}
                        aria-current={i === current ? "true" : undefined}
                        onClick={() => handleDotClick(i)}
                        className={`relative h-1.5 rounded-full transition-all duration-500 after:absolute after:-inset-x-[9px] after:-inset-y-[9px] after:content-[''] ${
                          i === current ? "w-8 bg-emerald-400" : "w-1.5 bg-white/20 hover:bg-white/40"
                        }`}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
