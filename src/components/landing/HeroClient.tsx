"use client";

import { useMemo, useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button, useTypewriter } from "./Primitives";
import { useLiveSnapshot } from "@/hooks/useLiveSnapshot";

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
      {/* No backdrop blur here: it paints in the first frame and cost ~45 ms of desktop FCP in lab runs */}
      <Button href="#how" size="lg" variant="secondary" className="backdrop-blur-none">See how it works</Button>
    </div>
  );
}

/**
 * The hero's line about paying, shown only while the wallet is switched on (Admin → Settings). With the
 * wallet off the site takes no money, so nothing about deposits, fees or paying may appear. It used to
 * say "Instant payouts", which the app never had: the wallet takes deposits for the day pass, and prizes
 * are delivered after a claim.
 *
 * The page's HTML is cached for every visitor, so it can't carry the switch: it is read in the browser
 * from the public snapshot (/api/live), shared with the quiz and CTA sections further down. The hero
 * asks for it as the page loads; Cloudflare caches that URL for 5 s, so Hostinger still sees about one
 * request per Cloudflare location per 5 s, however many visitors arrive. The words live in this client component, not in the page, so they are not even in
 * the HTML while the wallet is off. Until the snapshot arrives, and when it can't be loaded, nothing shows.
 */
export function WalletPaymentNote() {
  const { snapshot } = useLiveSnapshot();
  if (snapshot?.walletEnabled !== true) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="m10 16-4-4 1.4-1.4 2.6 2.6 5.6-5.6L17 9l-7 7Z" /></svg>
      </span>
      <span>Pay with Easypaisa or JazzCash</span>
    </div>
  );
}
