"use client";

import { useMemo, useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button, useTypewriter } from "./Primitives";

export function Particles() {
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

export function TypedTitle({ subheads }: { subheads: string[] }) {
  const typedText = useTypewriter(subheads, { typeSpeed: 50, deleteSpeed: 30, pause: 2200 });
  return <>{typedText}</>;
}

export function HeroCTA() {
  const { user, isLoading } = useAuth();
  const isLoggedIn = !!user;

  const ctaConfig = useMemo(() => {
    if (isLoading) return { href: "/quizzes", text: "Start Quiz Now", icon: "🎯" };
    if (isLoggedIn) return { href: "/quizzes", text: "Play Now", icon: "🚀" };
    return { href: "/register", text: "Play Free Now", icon: "🚀" };
  }, [isLoading, isLoggedIn]);

  return (
    <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
      <Button href={ctaConfig.href} size="lg" variant="primary" icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M13.4 5.6 12 7l4 4H4v2h12l-4 4 1.4 1.4L20 12l-6.6-6.4Z" /></svg>}>
        {ctaConfig.text}
      </Button>
      <Button href="#how" size="lg" variant="secondary">See how it works</Button>
    </div>
  );
}
