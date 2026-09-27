import dynamic from "next/dynamic";
import LazySection from "@/components/LazySection";
import ScrollProgress from "@/components/landing/ScrollProgress";
import SectionNav from "@/components/landing/SectionNav";
import Hero from "@/components/landing/Hero";

const DarkFallback = () => (
  <div className="min-h-[300px] w-full flex items-center justify-center py-10">
    <div className="h-64 w-full bg-white/[0.03] rounded-3xl animate-pulse border border-white/5" />
  </div>
);

const Stats = dynamic(() => import("@/components/landing/Stats"), { ssr: true, loading: DarkFallback });
const Marquee = dynamic(() => import("@/components/landing/Marquee"), { ssr: true, loading: () => <div className="h-28 w-full bg-white/[0.03] animate-pulse border-y border-white/5" /> });
const HowItWorks = dynamic(() => import("@/components/landing/HowItWorks"), { ssr: true, loading: DarkFallback });
const LiveQuiz = dynamic(() => import("@/components/landing/LiveQuiz"), { ssr: true, loading: DarkFallback });
const Prizes = dynamic(() => import("@/components/landing/Prizes"), { ssr: true, loading: DarkFallback });
const Leaderboard = dynamic(() => import("@/components/landing/Leaderboard"), { ssr: true, loading: DarkFallback });
const Testimonials = dynamic(() => import("@/components/landing/Testimonials"), { ssr: true, loading: DarkFallback });
const CTA = dynamic(() => import("@/components/landing/CTA"), { ssr: true, loading: DarkFallback });

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-ink-950 text-white">
      <ScrollProgress />
      <SectionNav />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-50"
        style={{ background: "radial-gradient(1200px 600px at 50% -10%, rgba(16,185,129,0.12), transparent 60%), radial-gradient(1000px 500px at 90% 30%, rgba(245,158,11,0.08), transparent 60%), radial-gradient(1000px 600px at 10% 80%, rgba(167,139,250,0.08), transparent 60%)" }}
      />
      <main>
        <Hero />
        <LazySection id="stats" fallback={<DarkFallback />} rootMargin="150px"><Stats /></LazySection>
        <LazySection id="marquee" fallback={<div className="h-28 w-full bg-white/[0.03] animate-pulse border-y border-white/5" />} rootMargin="150px"><Marquee /></LazySection>
        <LazySection id="how" fallback={<DarkFallback />} rootMargin="150px"><HowItWorks /></LazySection>
        <LazySection id="live" fallback={<DarkFallback />} rootMargin="150px"><LiveQuiz /></LazySection>
        <LazySection id="prizes" fallback={<DarkFallback />} rootMargin="150px"><Prizes /></LazySection>
        <LazySection id="leaderboard" fallback={<DarkFallback />} rootMargin="150px"><Leaderboard /></LazySection>
        <LazySection id="reviews" fallback={<DarkFallback />} rootMargin="150px"><Testimonials /></LazySection>
        <LazySection id="cta" fallback={<DarkFallback />} rootMargin="150px"><CTA /></LazySection>
      </main>
    </div>
  );
}
