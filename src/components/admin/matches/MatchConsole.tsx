'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Ban, Flag, Loader2, Lock, Undo2 } from 'lucide-react';
import { getCSRFHeaders } from '@/lib/csrf';
import { useNow } from '@/hooks/useNow';
import type { Extra, MatchEvent } from '@/lib/match-engine';
import type { MatchView } from '@/lib/match-service';
import { STATUS_LABELS } from './MatchList';

const EXTRA_BUTTONS: Array<{ extra: Extra; label: string }> = [
  { extra: 'none', label: 'Off the bat' },
  { extra: 'wide', label: 'Wide' },
  { extra: 'no_ball', label: 'No-ball' },
  { extra: 'bye', label: 'Bye' },
  { extra: 'leg_bye', label: 'Leg bye' },
];
const RUN_BUTTONS = [0, 1, 2, 3, 4, 5, 6];

const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50';
const toggle = (on: boolean) =>
  `${button} border ${on ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200' : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'}`;

/** 83 seconds as 1:23 */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type Question = MatchView['questions'][number];

function QuestionRow({ question, now }: { question: Question; now: number }) {
  const left = question.closesAt ? Date.parse(question.closesAt) - now : null;
  const state = question.state === 'open' && left !== null && left <= 0 ? 'closed' : question.state;
  const badge = state === 'open' ? (left === null ? 'Open' : `Open · closes in ${countdown(left)}`)
    : state === 'closed' ? 'Closed'
    : state === 'settled' ? `Settled: ${question.options[question.correctOption!] ?? '?'}`
    : 'Void';
  const tone = state === 'open' ? 'bg-emerald-500/20 text-emerald-200'
    : state === 'settled' ? 'bg-blue-500/20 text-blue-200'
    : state === 'void' ? 'bg-gray-500/20 text-gray-300'
    : 'bg-amber-500/20 text-amber-200';
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-white/10 bg-gray-900/40 p-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-white">{question.text}</span>
      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{badge}</span>
    </li>
  );
}

/**
 * The scorer console: an admin records each ball of a live match. Questions open, close and settle from
 * the balls (src/lib/match-engine.ts); an undone ball takes back what it caused. Every change carries the
 * version this screen saw, so two consoles can't overwrite each other: a refused change reloads.
 */
export default function MatchConsole({ matchId }: { matchId: string }) {
  const [view, setView] = useState<MatchView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState<Extra>('none');
  const [wicket, setWicket] = useState(false);
  // How far this device's clock is from the server's, for the countdowns
  const [skew, setSkew] = useState(0);

  const show = useCallback((next: MatchView) => {
    setView(next);
    setSkew(Date.parse(next.serverNow) - Date.now());
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/matches/${encodeURIComponent(matchId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      show(data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [matchId, show]);

  useEffect(() => {
    void load();
  }, [load]);

  const anyOpen = view?.questions.some((q) => q.state === 'open') ?? false;
  const now = useNow(1000, anyOpen) + skew;

  // One change at a time: every button that sends is disabled while one is on its way (React applies
  // a click's state before the next click, so a double click is caught too)
  const send = async (event: MatchEvent, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${encodeURIComponent(matchId)}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCSRFHeaders()) },
        // Only reachable from buttons shown once the match is loaded
        body: JSON.stringify({ version: view!.match.version, event }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Failed to save the change');
        // Someone else changed the match, or it was settled: show it as it is now
        if (response.status === 409) await load();
        return;
      }
      show(data);
      if (event.type === 'ball') {
        setExtra('none');
        setWicket(false);
      }
    } catch {
      toast.error('Failed to save the change. Check your connection: nothing was recorded.');
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return failed
      ? <p role="alert" className="text-red-300">The match could not be loaded. <button onClick={() => void load()} className="underline">Try again</button></p>
      : <p className="text-gray-400">Loading the match…</p>;
  }

  const { match } = view;
  const current = view.innings[view.innings.length - 1];
  const lastOver = current?.overs[current.overs.length - 1];
  const thisOver = lastOver && !lastOver.complete ? lastOver : null;
  const nextBatting = [match.teamA, match.teamB].find((team) => team !== view.innings[0]?.battingTeam)!;
  const questions = view.questions.filter((q) => q.innings === current?.innings).sort((a, b) => b.over - a.over);
  const firstOverOpen = current && current.overs.length === 0 && questions.some((q) => q.over === 1 && q.state === 'open');
  const firstOverLeft = firstOverOpen ? Math.min(...questions.filter((q) => q.over === 1).map((q) => Date.parse(q.closesAt!) - now)) : 0;
  const ball = (runs: number, isWicket = wicket) => send({ type: 'ball', runs, extra, wicket: isWicket });

  return (
    <div className="space-y-6">
      <section aria-label="Score" className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">{match.title}</h2>
            <p className="text-sm text-gray-400">T{match.oversPerInnings} · {match.questionsPerOver} question{match.questionsPerOver > 1 ? 's' : ''} an over · free entry</p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-gray-200">{STATUS_LABELS[match.status]}</span>
        </div>
        {view.innings.map((innings) => (
          <p key={innings.innings} className="text-lg text-white">
            <span className="font-semibold">{innings.battingTeam}</span> {innings.runs}/{innings.wickets}{' '}
            <span className="text-gray-400">({innings.oversText} overs{innings.target !== null ? `, target ${innings.target}` : ''})</span>
          </p>
        ))}
        {current && (
          <p className="text-sm text-gray-300" aria-label="This over">
            {thisOver ? `Over ${thisOver.number}: ${thisOver.balls.join(' ')}` : `Over ${current.overs.length + 1} next`}
          </p>
        )}
      </section>

      {view.settled && <p role="status" className="text-amber-200">This match&apos;s quiz has been settled, so it can&apos;t change any more.</p>}

      {!view.settled && (match.status === 'setup' || match.status === 'innings_break') && (
        <section aria-label="Start an innings" className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="font-semibold text-white">{match.status === 'setup' ? 'Who bats first?' : 'Start the second innings'}</h3>
          <div className="flex flex-wrap gap-3">
            {(match.status === 'setup' ? [match.teamA, match.teamB] : [nextBatting]).map((team) => (
              <button key={team} disabled={busy} onClick={() => send({ type: 'start_innings', battingTeam: team })} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
                {team} bat
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">Starting an innings opens the questions about its first over.</p>
        </section>
      )}

      {!view.settled && match.status === 'live' && (
        <section aria-label="Record a ball" className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6">
          {firstOverOpen && (
            <p role="status" className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">
              Over 1&apos;s questions close in {countdown(firstOverLeft)}. Close them before the first ball is bowled.
            </p>
          )}
          <div role="group" aria-label="Kind of delivery" className="flex flex-wrap gap-2">
            {EXTRA_BUTTONS.map((option) => (
              <button key={option.extra} type="button" aria-pressed={extra === option.extra} onClick={() => setExtra(option.extra)} className={toggle(extra === option.extra)}>
                {option.label}
              </button>
            ))}
            <button type="button" aria-pressed={wicket} onClick={() => setWicket(!wicket)} className={toggle(wicket)}>
              Wicket
            </button>
          </div>
          <div role="group" aria-label="Runs" className="flex flex-wrap gap-2">
            {RUN_BUTTONS.map((runs) => (
              <button key={runs} disabled={busy} onClick={() => ball(runs)} aria-label={`${runs} run${runs === 1 ? '' : 's'}`}
                className={`${button} h-14 w-14 bg-gray-800 text-lg text-white hover:bg-gray-700`}>
                {runs}
              </button>
            ))}
            <button disabled={busy} onClick={() => ball(0, true)} aria-label="Wicket, no run" className={`${button} h-14 w-14 bg-red-600 text-lg text-white hover:bg-red-700`}>
              W
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Pick the kind of delivery (and Wicket) first if it isn&apos;t a plain ball, then the runs. For a wide or no-ball, the runs are the ones
            taken on top of the penalty run.
          </p>
        </section>
      )}

      {!view.settled && match.status !== 'abandoned' && match.status !== 'setup' && (
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => send({ type: 'undo' })} className={`${button} bg-white/10 text-white hover:bg-white/15`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Undo last ball
          </button>
          {match.status === 'live' && (
            <>
              <button disabled={busy} onClick={() => send({ type: 'close_answers' })} className={`${button} bg-amber-600 text-white hover:bg-amber-700`}>
                <Lock className="h-4 w-4" /> Close answers now
              </button>
              <button disabled={busy} onClick={() => send({ type: 'end_innings' }, 'End this innings now? Its unfinished overs are voided.')} className={`${button} bg-white/10 text-white hover:bg-white/15`}>
                <Flag className="h-4 w-4" /> End innings
              </button>
            </>
          )}
          {match.status !== 'completed' && (
            <button disabled={busy} onClick={() => send({ type: 'abandon' }, 'Abandon the match? Every unsettled question is voided, and nothing more can be recorded.')} className={`${button} bg-red-600/80 text-white hover:bg-red-700`}>
              <Ban className="h-4 w-4" /> Abandon match
            </button>
          )}
        </div>
      )}

      {match.status === 'completed' && !view.settled && (
        <p role="status" className="text-sm text-gray-300">The match has finished. Settle its quiz from Settle Quizzes.</p>
      )}

      {questions.length > 0 && (
        <section aria-label="Questions" className="space-y-3">
          <h3 className="font-semibold text-white">Questions this innings</h3>
          <ul className="space-y-2">
            {questions.map((question) => <QuestionRow key={question.id} question={question} now={now} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
