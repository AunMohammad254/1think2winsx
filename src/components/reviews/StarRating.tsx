'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const STARS = [1, 2, 3, 4, 5];
export const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

/** Read-only stars, e.g. on a review card */
export function StarDisplay({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn('inline-flex gap-0.5', className)} role="img" aria-label={`${rating} out of 5 stars`}>
      {STARS.map((n) => (
        <Star key={n} aria-hidden="true" className={cn('h-4 w-4', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-white/20')} />
      ))}
    </span>
  );
}

/** Five stars to choose a rating from: a radio group, so arrow keys work too */
export function StarInput({ value, onChange, disabled }: { value: number; onChange: (rating: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label="Your rating" className="flex gap-1" onMouseLeave={() => setHover(0)}>
        {STARS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}, ${RATING_WORDS[n]}`}
            tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                onChange(Math.min(5, (value || 0) + 1));
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                onChange(Math.max(1, (value || 2) - 1));
              }
            }}
            className="rounded-md p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 disabled:opacity-50"
          >
            <Star aria-hidden="true" className={cn('h-8 w-8', n <= shown ? 'fill-amber-400 text-amber-400' : 'text-white/25')} />
          </button>
        ))}
      </div>
      <span className="text-sm font-medium text-amber-300" aria-hidden="true">{RATING_WORDS[shown]}</span>
    </div>
  );
}
