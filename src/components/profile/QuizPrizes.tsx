'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCSRFHeaders } from '@/lib/csrf';
import type { QuizPrize } from '@/lib/quiz-prizes';

const PLACE = ['', '1st', '2nd', '3rd'];

/** What the winner sees for each claim state, and whether they can send their details (again). */
function claimState(prize: QuizPrize): { text: string; tone: string; canSend: boolean } {
  const claim = prize.claim;
  if (!claim) return { text: 'Send your delivery details so we can get it to you.', tone: 'text-amber-200', canSend: true };
  switch (claim.status) {
    case 'pending':
      return { text: "Details received. We'll contact you on WhatsApp.", tone: 'text-amber-200', canSend: false };
    case 'approved':
      return { text: 'Approved: your prize is on its way soon.', tone: 'text-emerald-200', canSend: false };
    case 'fulfilled':
      return { text: 'Delivered.', tone: 'text-blue-200', canSend: false };
    default:
      return {
        text: `We couldn't use those details${claim.notes ? `: ${claim.notes}` : '.'} Please send them again.`,
        tone: 'text-rose-200',
        canSend: true,
      };
  }
}

const EMPTY_FORM = { fullName: '', whatsappNumber: '', address: '' };

/**
 * Prizes the player won in a quiz (F1): each shows where its delivery stands, and a winner who has not
 * sent their delivery details yet (or whose details were rejected) can send them here. Shows nothing
 * for a player who never won a prize.
 */
export default function QuizPrizes() {
  const [prizes, setPrizes] = useState<QuizPrize[]>([]);
  const [claiming, setClaiming] = useState<QuizPrize | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/quiz-prizes');
      if (!response.ok) return;
      const data = (await response.json()) as { prizes?: QuizPrize[] };
      setPrizes(data.prizes ?? []);
    } catch {
      // The rest of the profile still works; the list just stays as it was
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (prize: QuizPrize) => {
    setClaiming(prize);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const submit = async (event: React.FormEvent, target: QuizPrize) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quiz-prizes/${encodeURIComponent(target.winnerId)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCSRFHeaders()) },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setError(data.error || 'Could not save your delivery details. Please try again.');
        return;
      }
      setClaiming(null);
      setNotice(data.message || 'Thanks! We have your delivery details.');
      await load();
    } catch {
      setError('Could not save your delivery details. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (prizes.length === 0) return null;

  return (
    <section className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden" aria-label="Prizes you won">
      <div className="p-5 border-b border-white/10">
        <h2 className="text-lg font-bold text-white">🏆 Prizes you won</h2>
        {notice && <p role="status" className="mt-2 text-sm text-emerald-200">{notice}</p>}
      </div>
      <ul className="divide-y divide-white/10">
        {prizes.map((prize) => {
          const state = claimState(prize);
          return (
            <li key={prize.winnerId} className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white">{prize.prize.name}</p>
                <p className="text-xs text-slate-400">{PLACE[prize.rank]} place in &ldquo;{prize.quizTitle}&rdquo;</p>
                <p className={`mt-1 text-sm ${state.tone}`}>{state.text}</p>
              </div>
              {state.canSend && (
                <button
                  type="button"
                  onClick={() => open(prize)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 text-white text-sm font-semibold hover:from-emerald-800 hover:to-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                >
                  {prize.claim ? 'Send details again' : 'Add delivery details'}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {claiming && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-label={`Delivery details for ${claiming.prize.name}`}
            onSubmit={(event) => submit(event, claiming)}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 space-y-4"
          >
            <div>
              <h3 className="text-lg font-semibold text-white">Delivery details</h3>
              <p className="text-sm text-slate-400">For {claiming.prize.name}, won in &ldquo;{claiming.quizTitle}&rdquo;.</p>
            </div>
            <label className="block text-sm text-white">
              Full name
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="mt-1 w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm text-white">
              WhatsApp number
              <input
                required
                type="tel"
                value={form.whatsappNumber}
                onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
                className="mt-1 w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm text-white">
              Delivery address
              <textarea
                required
                rows={3}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="mt-1 w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-white resize-none"
              />
            </label>
            {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setClaiming(null)}
                disabled={submitting}
                className="flex-1 px-4 py-2 rounded-md bg-white/10 text-slate-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 rounded-md bg-emerald-600 text-white disabled:opacity-50">
                {submitting ? 'Sending…' : 'Send details'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
