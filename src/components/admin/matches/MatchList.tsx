'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Radio } from 'lucide-react';
import { getCSRFHeaders } from '@/lib/csrf';
import type { MatchListItem } from '@/lib/match-service';

export const STATUS_LABELS: Record<MatchListItem['status'], string> = {
  setup: 'Not started',
  live: 'Live',
  innings_break: 'Innings break',
  completed: 'Finished',
  abandoned: 'Abandoned',
};

const field = 'w-full rounded-lg border border-white/10 bg-gray-900/60 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none';

/**
 * Live Matches: start a new match (two teams, T20 or T10, questions per over) and open a match's scorer
 * console. A new match is a draft: players see nothing until it goes live.
 */
export default function MatchList() {
  const router = useRouter();
  const [matches, setMatches] = useState<MatchListItem[] | null>(null);
  const [form, setForm] = useState({ teamA: '', teamB: '', oversPerInnings: '20', questionsPerOver: '2' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/matches');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMatches(data.matches);
    } catch {
      setMatches([]);
      toast.error('Failed to load the matches');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCSRFHeaders()) },
        body: JSON.stringify({
          teamA: form.teamA,
          teamB: form.teamB,
          oversPerInnings: Number(form.oversPerInnings),
          questionsPerOver: Number(form.questionsPerOver),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed to create the match');
        return;
      }
      toast.success('Match created');
      router.push(`/admin/matches/${data.matchId}`);
    } catch {
      setError('Failed to create the match. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <form onSubmit={create} aria-label="New match" className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-semibold text-white">New match</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-gray-300">
            Team A
            <input required value={form.teamA} onChange={(e) => setForm({ ...form, teamA: e.target.value })} placeholder="e.g. Lahore Qalandars" className={`${field} mt-1`} />
          </label>
          <label className="block text-sm text-gray-300">
            Team B
            <input required value={form.teamB} onChange={(e) => setForm({ ...form, teamB: e.target.value })} placeholder="e.g. Karachi Kings" className={`${field} mt-1`} />
          </label>
          <label className="block text-sm text-gray-300">
            Format
            <select value={form.oversPerInnings} onChange={(e) => setForm({ ...form, oversPerInnings: e.target.value })} className={`${field} mt-1`} style={{ colorScheme: 'dark' }}>
              <option value="20">T20 (20 overs an innings)</option>
              <option value="10">T10 (10 overs an innings)</option>
            </select>
          </label>
          <label className="block text-sm text-gray-300">
            Questions per over
            <select value={form.questionsPerOver} onChange={(e) => setForm({ ...form, questionsPerOver: e.target.value })} className={`${field} mt-1`} style={{ colorScheme: 'dark' }}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-gray-400">
          Questions during each over are predictions about the next one, and close after its 5th legal ball. Entry is free.
          Players see nothing until the match goes live.
        </p>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create match
        </button>
      </form>

      <section aria-label="Matches" className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Matches</h2>
        {matches === null && <p className="text-sm text-gray-400">Loading…</p>}
        {matches?.length === 0 && <p className="text-sm text-gray-400">No matches yet.</p>}
        {matches?.map((match) => (
          <Link
            key={match.id}
            href={`/admin/matches/${match.id}`}
            className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-gray-900/40 px-4 py-3 hover:border-emerald-500/40"
          >
            <span className="flex items-center gap-3">
              <Radio className={`h-4 w-4 ${match.status === 'live' ? 'text-red-400' : 'text-gray-500'}`} />
              <span>
                <span className="block font-medium text-white">{match.teamA} vs {match.teamB}</span>
                <span className="block text-xs text-gray-400">
                  T{match.oversPerInnings} · created {new Date(match.createdAt).toLocaleString()}
                </span>
              </span>
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-gray-200">{STATUS_LABELS[match.status]}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
