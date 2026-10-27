'use client';

import { useEffect, useState } from 'react';
import { QUIZ_ACTION_LABELS, type QuizActionEntry } from '@/lib/admin-action-labels';

/** A short, readable line for an action's details (the full record stays in the database). */
function summary(entry: QuizActionEntry): string {
  const d = entry.details;
  switch (entry.action) {
    case 'quiz_status_changed':
      return `Status: ${(d.changes as { status: string }).status}`;
    case 'quiz_created':
    case 'quiz_edited':
      return typeof d.questions === 'number' ? `${d.questions} question${d.questions === 1 ? '' : 's'}` : '';
    case 'question_added':
    case 'question_deleted':
      return typeof d.text === 'string' ? `“${d.text}”` : '';
    case 'result_saved':
      return d.endedNow ? 'Ended the quiz' : '';
    case 'quiz_settled':
      return Array.isArray(d.winners) ? `${d.winners.length} winner${d.winners.length === 1 ? '' : 's'}` : '';
    case 'notices_resent':
      return typeof d.notified === 'number' ? `${d.notified} sent` : '';
    case 'quiz_announced':
      return d.resent ? 'Sent again' : '';
    case 'quiz_scheduled':
      return typeof d.startsAt === 'string' ? `For ${formatTime(d.startsAt)}` : '';
    default:
      return '';
  }
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' });

/** The admin quiz page's History tab: who did what to the quiz, newest first (F5). */
export default function QuizHistory({ quizId }: { quizId: string }) {
  const [actions, setActions] = useState<QuizActionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/quizzes/${encodeURIComponent(quizId)}/history`)
      .then(async (response) => {
        const data = (await response.json()) as { actions?: QuizActionEntry[]; error?: string };
        if (cancelled) return;
        if (!response.ok) setError(data.error || 'Failed to load the history');
        else setActions(data.actions ?? []);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load the history');
      });
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  if (error) return <p role="alert" className="text-sm text-rose-300">{error}</p>;
  if (!actions) return <p className="text-sm text-gray-400">Loading the history…</p>;
  if (actions.length === 0) {
    return <p className="text-sm text-gray-400">No admin actions recorded yet. Actions are recorded from 24 Oct 2026 on.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-gray-400">
          <tr>
            <th className="py-2 pr-4">When (PKT)</th>
            <th className="py-2 pr-4">Admin</th>
            <th className="py-2 pr-4">Action</th>
            <th className="py-2">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {actions.map((entry) => (
            <tr key={entry.id}>
              <td className="py-2 pr-4 text-gray-300 whitespace-nowrap">{formatTime(entry.createdAt)}</td>
              <td className="py-2 pr-4 text-gray-300">{entry.adminEmail}</td>
              <td className="py-2 pr-4 text-white">{QUIZ_ACTION_LABELS[entry.action] ?? entry.action}</td>
              <td className="py-2 text-gray-400">{summary(entry)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
