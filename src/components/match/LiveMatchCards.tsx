import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { LiveMatchCard } from '@/lib/quiz-catalog';

const LABELS: Record<LiveMatchCard['status'], string> = {
  setup: 'Starting soon',
  live: 'Live now',
  innings_break: 'Innings break',
  completed: 'Finished',
  abandoned: 'Abandoned',
};

/**
 * The live matches players can see (match mode), at the top of the quiz list. Each is played on its own
 * screen (/match/[id]), free, whatever the player's day pass. The list comes from the /api/live snapshot.
 */
export default function LiveMatchCards({ matches }: { matches: LiveMatchCard[] }) {
  if (matches.length === 0) return null;
  return (
    <section aria-label="Live matches" className="mb-8 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Live matches: predict every over</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {matches.map((match) => {
          const ended = match.status === 'completed' || match.status === 'abandoned';
          // Shown to signed-in players only: no prefetch (it would be a request to Hostinger per card)
          return (
            <Link key={match.id} href={`/match/${match.id}`} prefetch={false}
              className="block rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-900/30 to-blue-900/20 p-5 transition-colors hover:border-emerald-300/60">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${match.status === 'live' ? 'bg-red-500/20 text-red-200' : 'bg-white/10 text-gray-200'}`}>
                  {match.status === 'live' && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />}
                  {LABELS[match.status]}
                </span>
                <span className="text-xs text-gray-400">Free to play</span>
              </div>
              <p className="mt-3 text-xl font-bold text-white">{match.title}</p>
              <p className="mt-1 text-sm text-gray-300">Har over ki prediction karein · Predict every over</p>
              <span className="mt-4 inline-flex items-center gap-1 font-semibold text-emerald-300">
                {ended ? 'See how it ended' : 'Play now'} <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
