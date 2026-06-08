'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';

interface LazySectionProps {
  children: ReactNode;
  className?: string;
  threshold?: number;
  rootMargin?: string;
  fallback?: ReactNode;
  delay?: number;
}

export default function LazySection({
  children,
  className = '',
  threshold = 0.1,
  rootMargin = '100px',
  fallback,
  delay = 0,
}: LazySectionProps) {
  const [shouldRender, setShouldRender] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay > 0) {
            setTimeout(() => setShouldRender(true), delay);
          } else {
            setShouldRender(true);
          }
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, [threshold, rootMargin, delay]);

  useEffect(() => {
    if (shouldRender) {
      // Trigger fade-in after mount
      const raf = requestAnimationFrame(() => setIsMounted(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [shouldRender]);

  return (
    <div ref={sectionRef} className={className}>
      {shouldRender ? (
        <div
          className={`transition-opacity duration-700 ease-out ${
            isMounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {children}
        </div>
      ) : (
        fallback || (
          <div className="min-h-[200px] flex items-center justify-center">
            <div className="animate-pulse bg-white/5 rounded-lg w-full h-32" />
          </div>
        )
      )}
    </div>
  );
}