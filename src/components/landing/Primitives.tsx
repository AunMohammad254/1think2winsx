"use client";

import { useEffect, useState, useRef, CSSProperties, ReactNode, forwardRef } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

/* ============================
   HOOKS
   ============================ */

export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options: { threshold?: number; rootMargin?: string; once?: boolean; delay?: number } = {}
) {
  const { threshold = 0.15, rootMargin = "0px 0px -60px 0px", once = true } = options;
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setIsVisible(false);
          }
        });
      },
      { threshold, rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, isVisible } as const;
}

export function useCountUp(target: number, duration = 1800, startWhen = true) {
  const ref = useRef<HTMLElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!startWhen || startedRef.current || !ref.current) return;
    startedRef.current = true;

    const formatNumber = (n: number) => n >= 1000 ? n.toLocaleString() : n.toString();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      ref.current.textContent = formatNumber(target);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(target * eased);
      
      if (ref.current) {
        ref.current.textContent = formatNumber(current);
      }
      
      if (progress < 1) raf = requestAnimationFrame(tick);
      else if (ref.current) ref.current.textContent = formatNumber(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, startWhen]);

  return ref;
}

export function useParallaxPointer(strength = 12) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    
    let raf = 0;
    let rect: DOMRect | null = null;
    
    const onMouseEnter = () => {
      rect = node.getBoundingClientRect();
    };

    const onMove = (e: MouseEvent) => {
      if (!rect) {
        rect = node.getBoundingClientRect();
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = (e.clientX - rect!.left) / rect!.width - 0.5;
        const y = (e.clientY - rect!.top) / rect!.height - 0.5;
        node.style.transform = `translate3d(${x * strength}px, ${y * strength}px, 0)`;
      });
    };
    
    const reset = () => { 
      node.style.transform = "translate3d(0,0,0)"; 
      rect = null;
    };
    
    const parent = node.parentElement ?? window;
    parent.addEventListener("mouseenter", onMouseEnter, { passive: true });
    parent.addEventListener("mousemove", onMove as EventListener, { passive: true });
    parent.addEventListener("mouseleave", reset as EventListener);
    
    return () => {
      parent.removeEventListener("mouseenter", onMouseEnter);
      parent.removeEventListener("mousemove", onMove as EventListener);
      parent.removeEventListener("mouseleave", reset as EventListener);
      cancelAnimationFrame(raf);
    };
  }, [strength]);
  return ref;
}

export function useActiveSection(sectionIds: string[], _rootMargin = "0px 0px 0px 0px") {
  const [activeId, setActiveId] = useState(sectionIds[0]);

  useEffect(() => {
    let rafId: number;
    
    const handleScroll = () => {
      // Find the section that occupies the space just below the navbar
      let currentActiveId = sectionIds[0];
      const triggerY = 150; // 80px navbar + padding

      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= triggerY && rect.bottom >= triggerY) {
            currentActiveId = id;
            break;
          }
        }
      }

      setActiveId(currentActiveId);
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(handleScroll);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    // Initial check
    handleScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [sectionIds.join(",")]);
  
  return { activeId, setActiveId };
}

export function useTypewriter(words: string[], { typeSpeed = 60, deleteSpeed = 35, pause = 2000 } = {}) {
  const [text, setText] = useState(words[0]);
  const [wordIndex, setWordIndex] = useState(0);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const currentWord = words[wordIndex];
    const isDeleting = text !== currentWord && !currentWord.startsWith(text);
    if (text !== currentWord) {
      if (isDeleting) {
        timeout = setTimeout(() => setText((p) => p.slice(0, -1)), deleteSpeed);
      } else {
        timeout = setTimeout(() => setText(currentWord.slice(0, text.length + 1)), typeSpeed);
      }
    } else {
      timeout = setTimeout(() => {
        setWordIndex((i) => (i + 1) % words.length);
        setText((p) => p.slice(0, -1));
      }, pause);
    }
    return () => clearTimeout(timeout);
  }, [text, wordIndex, words, typeSpeed, deleteSpeed, pause]);
  return text;
}

export function useAnimatedCounter(target: number, duration = 1500) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target <= 0) return;
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.floor(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

/* ============================
   UI PRIMITIVES
   ============================ */

export interface SectionProps {
  id?: string;
  children: ReactNode;
  className?: string;
  containerClassName?: string;
}

export const Section = forwardRef<HTMLElement, SectionProps>(
  ({ id, children, className, containerClassName }, ref) => {
    return (
      <section id={id} ref={ref} className={cn("relative w-full py-20 sm:py-28 lg:py-32", className)}>
        <div className={cn("mx-auto w-full max-w-7xl px-5 sm:px-8", containerClassName)}>{children}</div>
      </section>
    );
  }
);

Section.displayName = "Section";

export function Eyebrow({ children, tone = "pitch", className }: { children: ReactNode; tone?: "pitch" | "trophy" | "live"; className?: string }) {
  const tones = {
    pitch: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    trophy: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    live: "border-red-500/30 bg-red-500/10 text-red-300",
  } as const;
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]", tones[tone], className)}>
      {tone === "live" && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-pulse" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
      )}
      {children}
    </span>
  );
}

export interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: "up" | "left" | "right" | "scale" | "fade";
  as?: keyof React.JSX.IntrinsicElements;
}

export function Reveal({ children, className, delay = 0, variant = "up", as: Tag = "div" }: RevealProps) {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();
  const variantClass = variant === "left" ? "reveal-left" : variant === "right" ? "reveal-right" : variant === "scale" ? "reveal-scale" : "";
  const style: CSSProperties = { transitionDelay: `${delay}ms` };
  const Component = Tag as React.ElementType;
  return (
    <Component ref={ref} style={style} className={cn("reveal", variantClass, isVisible && "is-visible", className)}>
      {children}
    </Component>
  );
}

export interface ButtonProps {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "trophy";
  size?: "sm" | "md" | "lg";
  className?: string;
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
}

export function Button({ children, variant = "primary", size = "md", className, href, onClick, icon }: ButtonProps) {
  const base = "btn-shine group relative inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-tight transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950";
  const sizes = { sm: "px-4 py-2 text-sm", md: "px-6 py-3 text-sm", lg: "px-8 py-4 text-base" };
  const variants = {
    primary: "bg-gradient-to-r from-emerald-500 via-emerald-400 to-amber-400 text-ink-950 hover:scale-[1.03] shadow-[0_10px_40px_-10px_rgba(16,185,129,0.6)] focus-visible:ring-emerald-400",
    trophy: "bg-gradient-to-r from-amber-400 to-orange-500 text-ink-950 hover:scale-[1.03] shadow-[0_10px_40px_-10px_rgba(245,158,11,0.6)] focus-visible:ring-amber-400",
    secondary: "border border-white/15 bg-white/5 text-white hover:bg-white/10 hover:border-white/30 backdrop-blur-md focus-visible:ring-white/50",
    ghost: "text-white/80 hover:text-white",
  };
  const content = (
    <>
      <span className="relative z-10">{children}</span>
      {icon && <span className="relative z-10 transition-transform duration-300 group-hover:translate-x-1">{icon}</span>}
    </>
  );

  if (href) {
    if (href.startsWith("/")) {
      return (
        <Link href={href} className={cn(base, sizes[size], variants[variant], className)}>
          {content}
        </Link>
      );
    }
    return <a href={href} className={cn(base, sizes[size], variants[variant], className)}>{content}</a>;
  }
  return <button onClick={onClick} className={cn(base, sizes[size], variants[variant], className)}>{content}</button>;
}

export function Card({ children, className, glow }: { children: ReactNode; className?: string; glow?: "pitch" | "trophy" | "none" }) {
  return (
    <div className={cn("lift group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-6 backdrop-blur-xl", glow === "pitch" && "hover:glow-pitch", glow === "trophy" && "hover:glow-trophy", className)}>
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
        <div className="absolute -top-px left-1/2 h-px w-1/2 -translate-x-1/2 bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
      </div>
      {children}
    </div>
  );
}

export function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="trophy-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="60%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <path d="M7 4h10v3a5 5 0 0 1-10 0V4Z" fill="url(#trophy-grad)" />
      <path d="M5 5H3a2 2 0 0 0 2 4" stroke="url(#trophy-grad)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M19 5h2a2 2 0 0 1-2 4" stroke="url(#trophy-grad)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 14h6l-1 3h-4l-1-3Z" fill="url(#trophy-grad)" />
      <rect x="7" y="19" width="10" height="2" rx="1" fill="url(#trophy-grad)" />
    </svg>
  );
}

export function SectionHeading({ eyebrow, title, description, align = "center", tone = "pitch" }: { eyebrow?: string; title: ReactNode; description?: ReactNode; align?: "center" | "left"; tone?: "pitch" | "trophy" | "live" }) {
  return (
    <div className={cn("mx-auto max-w-3xl", align === "center" ? "text-center" : "text-left mx-0")}>
      {eyebrow && <Reveal><Eyebrow tone={tone}>{eyebrow}</Eyebrow></Reveal>}
      <Reveal delay={100}><h2 className="mt-5 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">{title}</h2></Reveal>
      {description && <Reveal delay={200}><p className="mt-5 text-base text-white/60 sm:text-lg">{description}</p></Reveal>}
    </div>
  );
}

export function CricketBall({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={cn("drop-shadow-[0_10px_30px_rgba(220,38,38,0.5)]", className)} aria-hidden="true">
      <defs>
        <radialGradient id="ball-grad" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fca5a5" />
          <stop offset="35%" stopColor="#dc2626" />
          <stop offset="80%" stopColor="#7f1d1d" />
          <stop offset="100%" stopColor="#450a0a" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#ball-grad)" />
      <path d="M 8 50 Q 50 30 92 50" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeDasharray="3 3" fill="none" />
      <path d="M 8 50 Q 50 70 92 50" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeDasharray="3 3" fill="none" />
      <circle cx="35" cy="35" r="10" fill="rgba(255,255,255,0.18)" />
    </svg>
  );
}
