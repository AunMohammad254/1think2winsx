"use client";

import { useState, useEffect, memo } from "react";
import { Section, SectionHeading, Reveal } from "./Primitives";
import ReviewModal from "@/components/reviews/ReviewModal";
import { StarDisplay } from "@/components/reviews/StarRating";
import type { PublicReview, PublicReviewsResponse } from "@/lib/reviews";

/**
 * Player reviews on the home page: only the ones an admin approved (/admin/reviews), with their real
 * average. Loaded in the browser from /api/reviews because Cloudflare caches the home page's HTML.
 * "Write a review" opens the Review modal; a new review waits for approval before it shows here.
 */

const AVATARS = [
  "from-emerald-400 to-cyan-400",
  "from-violet-500 to-pink-500",
  "from-amber-400 to-orange-500",
  "from-rose-400 to-red-500",
  "from-blue-400 to-violet-500",
];
/** Fewer than this and the cards sit in a row instead of scrolling past */
const MARQUEE_MIN = 3;

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");

const ReviewCard = memo(function ReviewCard({ r, index, hidden }: { r: PublicReview; index: number; hidden?: boolean }) {
  const onMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(1000px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateZ(10px)`;
  };

  const onMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.transform = "perspective(1000px) rotateY(0deg) rotateX(0deg) translateZ(0)";
  };

  return (
    <article
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      // The marquee's second copy is decoration: screen readers hear each review once
      aria-hidden={hidden || undefined}
      className="lift mx-2 w-[320px] shrink-0 rounded-2xl border border-white/10 bg-linear-to-b from-white/8 to-white/3 p-6 transition-all duration-200 sm:w-90"
      style={{ animation: `fade-up 0.5s ease-out ${index * 0.08}s both` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-linear-to-br ${AVATARS[index % AVATARS.length]} text-sm font-bold text-white`}>
            {initials(r.displayName)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-white">{r.displayName}</p>
            {r.city && <p className="truncate text-xs text-white/60">{r.city}</p>}
          </div>
        </div>
        <StarDisplay rating={r.rating} className="shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5" />
      </div>
      <p className="mt-5 text-sm leading-relaxed text-white/75 break-words">&ldquo;{r.comment}&rdquo;</p>
    </article>
  );
});

// Its own component so the 4-second spotlight tick re-renders only this card, not the whole section
function FeaturedReview({ reviews }: { reviews: PublicReview[] }) {
  const [spotlightIndex, setSpotlightIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setSpotlightIndex((i) => (i + 1) % reviews.length);
    }, 4000);
    return () => clearInterval(id);
  }, [reviews.length]);

  const spotlight = reviews[spotlightIndex % reviews.length];

  return (
    <div className="mx-auto mt-14 max-w-md">
      <div className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-linear-to-br from-emerald-500/8 to-amber-400/5 p-6 transition-all duration-700">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Featured review
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-linear-to-br ${AVATARS[spotlightIndex % AVATARS.length]} text-sm font-bold text-white`}>
            {initials(spotlight.displayName)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-white">{spotlight.displayName}</p>
            {spotlight.city && <p className="truncate text-xs text-white/60">{spotlight.city}</p>}
          </div>
          <div className="ml-auto"><StarDisplay rating={spotlight.rating} /></div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/75 break-words">&ldquo;{spotlight.comment}&rdquo;</p>
      </div>
    </div>
  );
}

export default function Testimonials() {
  const [data, setData] = useState<PublicReviewsResponse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/reviews", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: PublicReviewsResponse | null) => {
        // A failed load shows the same invitation as an empty list
        setData(body && Array.isArray(body.reviews) ? body : { reviews: [], summary: { count: 0, average: 0 } });
      })
      .catch(() => {
        if (!controller.signal.aborted) setData({ reviews: [], summary: { count: 0, average: 0 } });
      });
    return () => controller.abort();
  }, []);

  const reviews = data?.reviews ?? [];
  const summary = data?.summary;
  const hasReviews = reviews.length > 0;
  const writeButton = (
    <button
      type="button"
      onClick={() => setModalOpen(true)}
      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-linear-to-r from-emerald-600 to-teal-500 px-6 font-semibold text-white shadow-lg shadow-emerald-500/20 transition-shadow hover:shadow-emerald-500/40"
    >
      ✍️ Write a review
    </button>
  );

  return (
    <Section className="relative overflow-hidden">
      <SectionHeading
        eyebrow="Player reviews"
        title={
          hasReviews && summary ? (
            <>Rated <span className="text-gradient-cool">{summary.average.toFixed(1)}★</span> by our players.</>
          ) : (
            <>What do <span className="text-gradient-cool">you</span> think?</>
          )
        }
        description={
          hasReviews && summary
            ? `${summary.count} ${summary.count === 1 ? "review" : "reviews"} from sports fans who play on 1Think 2Win. Every review is checked by our team before it appears.`
            : "Played a quiz with us? Tell other sports fans how it went."
        }
      />

      {data === null && (
        <div className="mt-14 flex justify-center gap-4" aria-hidden="true">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-44 w-[320px] shrink-0 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
          ))}
        </div>
      )}

      {hasReviews && (
        <Reveal delay={150}>
          {reviews.length >= MARQUEE_MIN ? (
            <div className="relative mt-14">
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-linear-to-r from-ink-950 to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-linear-to-l from-ink-950 to-transparent" />
              <div className="marquee-pause overflow-hidden">
                <div className="marquee-track" style={{ animationDuration: `${Math.max(30, reviews.length * 6)}s` }}>
                  {[...reviews, ...reviews].map((r, i) => (
                    <ReviewCard key={`${r.id}-${i}`} r={r} index={i} hidden={i >= reviews.length} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-14 flex flex-wrap justify-center gap-y-4">
              {reviews.map((r, i) => (
                <ReviewCard key={r.id} r={r} index={i} />
              ))}
            </div>
          )}
        </Reveal>
      )}

      {data !== null && (
        <Reveal delay={300}>
          <div className="mt-12 flex justify-center">{writeButton}</div>
        </Reveal>
      )}

      {reviews.length > 1 && (
        <Reveal delay={450}>
          <FeaturedReview reviews={reviews} />
        </Reveal>
      )}

      <ReviewModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </Section>
  );
}
