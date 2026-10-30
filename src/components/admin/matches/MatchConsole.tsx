'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Ban, Eye, EyeOff, Flag, Loader2, Lock, LockOpen, Pencil, Play, Radio, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import { getCSRFHeaders } from '@/lib/csrf';
import { useNow } from '@/hooks/useNow';
import type { Extra, MatchEvent } from '@/lib/match-engine';
import { MAX_ENTRIES_LIMIT } from '@/lib/quiz-entries';
import { formatClock } from '@/lib/live-countdown';
import type { DraftToSend, MatchView, ViewBall } from '@/lib/match-service';
import { STATUS_LABELS } from './MatchList';
import QuestionReview from './QuestionReview';

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

type Question = MatchView['questions'][number];

function QuestionRow({ question, now }: { question: Question; now: number }) {
  const left = question.closesAt ? Date.parse(question.closesAt) - now : null;
  const state = question.state === 'open' && left !== null && left <= 0 ? 'closed' : question.state;
  const badge = state === 'open' ? (left === null ? 'Open' : `Open · closes in ${formatClock(left)}`)
    : state === 'closed' ? 'Closed'
    : state === 'settled' ? `Settled: ${question.options[question.correctOption!] ?? '?'}`
    : 'Void';
  const tone = state === 'open' ? 'bg-emerald-500/20 text-emerald-200'
    : state === 'settled' ? 'bg-blue-500/20 text-blue-200'
    : state === 'void' ? 'bg-gray-500/20 text-gray-300'
    : 'bg-amber-500/20 text-amber-200';
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-white/10 bg-gray-900/40 p-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-white">
        {question.textRomanUrdu && <span className="block">{question.textRomanUrdu}</span>}
        <span className={question.textRomanUrdu ? 'block text-xs text-gray-400' : undefined}>{question.text}</span>
      </span>
      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{badge}</span>
    </li>
  );
}

/** The kind of delivery and Wicket, then the runs, which send. Shared by recording a ball and correcting one. */
function DeliveryPad({ busy, onRuns, initial, label }: {
  busy: boolean;
  /** Resolves true once saved */
  onRuns: (runs: number, extra: Extra, wicket: boolean) => Promise<boolean>;
  initial?: Pick<ViewBall, 'extra' | 'wicket'>;
  label: string;
}) {
  const [extra, setExtra] = useState<Extra>(initial?.extra ?? 'none');
  const [wicket, setWicket] = useState(initial?.wicket ?? false);
  const pick = async (runs: number, isWicket = wicket) => {
    // Saved: back to a plain ball for the next one. Not saved: the choice stays, to try again
    if (await onRuns(runs, extra, isWicket)) {
      setExtra('none');
      setWicket(false);
    }
  };
  return (
    <>
      <div role="group" aria-label={`Kind of delivery${label}`} className="flex flex-wrap gap-2">
        {EXTRA_BUTTONS.map((option) => (
          <button key={option.extra} type="button" aria-pressed={extra === option.extra} onClick={() => setExtra(option.extra)} className={toggle(extra === option.extra)}>
            {option.label}
          </button>
        ))}
        <button type="button" aria-pressed={wicket} onClick={() => setWicket(!wicket)} className={toggle(wicket)}>
          Wicket
        </button>
      </div>
      <div role="group" aria-label={`Runs${label}`} className="flex flex-wrap gap-2">
        {RUN_BUTTONS.map((runs) => (
          <button key={runs} disabled={busy} onClick={() => void pick(runs)} aria-label={`${runs} run${runs === 1 ? '' : 's'}${label}`}
            className={`${button} h-14 w-14 bg-gray-800 text-lg text-white hover:bg-gray-700`}>
            {runs}
          </button>
        ))}
        <button disabled={busy} onClick={() => void pick(0, true)} aria-label={`Wicket, no run${label}`} className={`${button} h-14 w-14 bg-red-600 text-lg text-white hover:bg-red-700`}>
          W
        </button>
      </div>
    </>
  );
}

/** How many players have joined, and the box that changes how many may */
function PlayerLimit({ players, busy, onSave }: { players: NonNullable<MatchView['players']>; busy: boolean; onSave: (maxEntries: number) => Promise<boolean> }) {
  const [value, setValue] = useState(String(players.maxEntries));
  const limit = Number(value);
  const valid = Number.isInteger(limit) && limit >= 1 && limit <= MAX_ENTRIES_LIMIT;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-xs text-gray-400">
        <span className="block">Players who can join</span>
        <input type="number" min={1} max={MAX_ENTRIES_LIMIT} value={value} onChange={(e) => setValue(e.target.value)}
          className="w-32 rounded-xl border border-white/10 bg-gray-900/60 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none" />
      </label>
      <button type="button" disabled={busy || !valid || limit === players.maxEntries} onClick={() => void onSave(limit)} className={`${button} bg-white/10 text-white hover:bg-white/15`}>
        Save
      </button>
      <p className="text-sm text-gray-300">{players.entries.toLocaleString()} of {players.maxEntries.toLocaleString()} joined</p>
    </div>
  );
}

interface Editing { ball: ViewBall; innings: number; over: number; position: number }

/**
 * The scorer console: an admin records each ball of a live match. Questions open, close and settle from
 * the balls (src/lib/match-engine.ts); an undone or corrected ball takes back what it caused. Mistakes
 * can be put right until the match's quiz is settled: any ball corrected, an innings ended by hand
 * resumed, one started with the wrong team removed, answers closed too early reopened (while their over
 * hasn't started), an abandoned match restored. Every change carries the version this screen saw, so
 * two consoles can't overwrite each other: a refused change reloads.
 *
 * An over's questions wait for review (QuestionReview) unless the match sends them automatically.
 * Players see nothing until an admin takes the match live (Go live), which also tells every player; Hide
 * takes it back off. The Players box sets how many may join.
 */
export default function MatchConsole({ matchId }: { matchId: string }) {
  const [view, setView] = useState<MatchView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
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
  const anyWaiting = view?.drafts.some((d) => d.state === 'waiting') ?? false;
  const now = useNow(1000, anyOpen || anyWaiting) + skew;

  // One change at a time: every button that sends is disabled while one is on its way (React applies
  // a click's state before the next click, so a double click is caught too). `confirmed` asks first.
  const save = async (path: string, method: 'POST' | 'PATCH', body: unknown, confirmed: () => boolean = () => true): Promise<boolean> => {
    if (!confirmed()) return false;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${encodeURIComponent(matchId)}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(await getCSRFHeaders()) },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Failed to save the change');
        // Someone else changed the match, or it was settled: show it as it is now
        if (response.status === 409) await load();
        return false;
      }
      show(data);
      setEditing(null);
      return true;
    } catch {
      toast.error('Failed to save the change. Check your connection: nothing was recorded.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  // Only reachable from buttons shown once the match is loaded
  const send = (event: MatchEvent, confirmed?: () => boolean) => save('/events', 'POST', { version: view!.match.version, event }, confirmed);
  const sendQuestions = (questions: DraftToSend[]) => save('/questions', 'POST', { action: 'send', questions });
  const skipQuestions = (ids: string[]) => save('/questions', 'POST', { action: 'skip', ids });
  const ask = (text: string) => () => window.confirm(text);
  const setAutoSend = (autoSend: boolean) => save('', 'PATCH', { autoSend }, autoSend
    ? ask("Send each over's questions as they are written, without review? Gemini can get a wording wrong; the built-in wording is used whenever it does.")
    : undefined);
  const setPublished = (published: boolean) => save('', 'PATCH', { published }, ask(published
    ? 'Take this match live? Players see it on the quiz list and every player gets a notification (only the first time).'
    : 'Hide this match from players? They can\'t answer until you take it live again.'));
  const setMaxEntries = (maxEntries: number) => save('', 'PATCH', { maxEntries },
    maxEntries < view!.players!.entries ? ask(`${view!.players!.entries} players have already joined, so nobody new can join. Save anyway?`) : undefined);

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
  const abandoned = match.status === 'abandoned';
  const canCorrect = !view.settled && !abandoned;
  const reopenCount = view.questions.filter((q) => q.reopenable).length;
  const canResume = canCorrect && current?.endReason === 'admin';
  const canRemove = canCorrect && current !== undefined && current.overs.length === 0;
  const abandonConfirmed = () => {
    const typed = window.prompt(
      `Abandoning voids every unsettled question and stops the match (Restore match puts it back until the quiz is settled).\n\nType the match name to confirm: ${match.title}`,
    );
    return typed !== null && typed.trim().toLowerCase() === match.title.toLowerCase();
  };

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
        {!view.settled && !abandoned && (
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={match.autoSend} disabled={busy} onChange={(e) => void setAutoSend(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
            Send questions automatically, without review
          </label>
        )}
        {view.innings.map((innings) => (
          <p key={innings.innings} className="text-lg text-white">
            <span className="font-semibold">{innings.battingTeam}</span> {innings.runs}/{innings.wickets}{' '}
            <span className="text-gray-400">({innings.oversText} overs{innings.target !== null ? `, target ${innings.target}` : ''})</span>
          </p>
        ))}
        {current && (
          <p className="text-sm text-gray-300" aria-label="This over">
            {thisOver ? `Over ${thisOver.number}: ${thisOver.balls.map((b) => b.label).join(' ')}` : `Over ${current.overs.length + 1} next`}
          </p>
        )}
      </section>

      {view.settled && <p role="status" className="text-amber-200">This match&apos;s quiz has been settled, so it can&apos;t change any more.</p>}

      {!view.settled && (
        <section aria-label="Players" className={`space-y-4 rounded-2xl border p-6 ${match.published ? 'border-emerald-400/30 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="font-semibold text-white">{match.published ? 'Players can see this match' : 'Players can\'t see this match yet'}</h3>
              <p className="text-xs text-gray-400">
                {match.published
                  ? <>They play it at <a href={`/match/${match.id}`} target="_blank" rel="noreferrer" className="underline">/match/{match.id}</a>.</>
                  : 'Go live puts it on the quiz list and tells every player.'}
              </p>
            </div>
            {match.published ? (
              <button type="button" disabled={busy} onClick={() => void setPublished(false)} className={`${button} bg-white/10 text-white hover:bg-white/15`}>
                <EyeOff className="h-4 w-4" /> Hide from players
              </button>
            ) : (
              <button type="button" disabled={busy || abandoned} onClick={() => void setPublished(true)} className={`${button} bg-red-600 text-white hover:bg-red-700`}>
                <Radio className="h-4 w-4" /> Go live
              </button>
            )}
          </div>
          {abandoned && !match.published && <p className="text-xs text-gray-400"><Eye className="mr-1 inline h-3 w-3" />Restore the match before taking it live.</p>}
          {view.players && <PlayerLimit key={view.players.maxEntries} players={view.players} busy={busy} onSave={setMaxEntries} />}
        </section>
      )}

      {!view.settled && <QuestionReview drafts={view.drafts} now={now} busy={busy} onSend={sendQuestions} onSkip={skipQuestions} />}

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
              Over 1&apos;s questions close in {formatClock(firstOverLeft)}. Close them before the first ball is bowled.
            </p>
          )}
          <DeliveryPad busy={busy} label="" onRuns={(runs, extra, wicket) => send({ type: 'ball', runs, extra, wicket })} />
          <p className="text-xs text-gray-400">
            Pick the kind of delivery (and Wicket) first if it isn&apos;t a plain ball, then the runs. For a wide or no-ball, the runs are the ones
            taken on top of the penalty run.
          </p>
        </section>
      )}

      {!view.settled && !abandoned && match.status !== 'setup' && (
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => send({ type: 'undo' })} className={`${button} bg-white/10 text-white hover:bg-white/15`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Undo last ball
          </button>
          {match.status === 'live' && (
            <>
              <button disabled={busy} onClick={() => send({ type: 'close_answers' }, ask("Close every open question now? Players can't answer them any more.\n\nReopen answers puts back any whose over hasn't started."))}
                className={`${button} bg-amber-600 text-white hover:bg-amber-700`}>
                <Lock className="h-4 w-4" /> Close answers now
              </button>
              <button disabled={busy} onClick={() => send({ type: 'end_innings' }, ask('End this innings now? Its unfinished overs are voided.\n\nResume innings puts it back while the next innings has no balls.'))}
                className={`${button} bg-white/10 text-white hover:bg-white/15`}>
                <Flag className="h-4 w-4" /> End innings
              </button>
            </>
          )}
          {match.status !== 'completed' && (
            <button disabled={busy} onClick={() => send({ type: 'abandon' }, abandonConfirmed)} className={`${button} bg-red-600/80 text-white hover:bg-red-700`}>
              <Ban className="h-4 w-4" /> Abandon match
            </button>
          )}
        </div>
      )}

      {(canResume || canRemove || reopenCount > 0 || (abandoned && !view.settled)) && (
        <section aria-label="Put a mistake right" className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-6">
          <h3 className="font-semibold text-white">Put a mistake right</h3>
          <div className="flex flex-wrap gap-3">
            {abandoned && !view.settled && (
              <button disabled={busy} onClick={() => send({ type: 'restore' }, ask('Restore the match? Settled results stand, and the overs it voided come back. Answers stay closed until you reopen them.'))}
                className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
                <RotateCcw className="h-4 w-4" /> Restore match
              </button>
            )}
            {canResume && (
              <button disabled={busy} onClick={() => send({ type: 'resume_innings' })} className={`${button} bg-white/10 text-white hover:bg-white/15`}>
                <Play className="h-4 w-4" /> Resume innings {current.innings}
              </button>
            )}
            {canRemove && (
              <button disabled={busy}
                onClick={() => send({ type: 'remove_innings' }, ask(`Remove innings ${current.innings} (${current.battingTeam} batting)? Its questions are removed; any players already answered are voided.`))}
                className={`${button} bg-white/10 text-white hover:bg-white/15`}>
                <Trash2 className="h-4 w-4" /> Remove innings {current.innings}
              </button>
            )}
            {reopenCount > 0 && (
              <button disabled={busy} onClick={() => send({ type: 'reopen_answers' })} className={`${button} bg-white/10 text-white hover:bg-white/15`}>
                <LockOpen className="h-4 w-4" /> Reopen answers ({reopenCount})
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400">
            To fix a wrong ball, pick it in the scorecard below. A question whose over has started never takes answers again.
          </p>
        </section>
      )}

      {view.innings.some((innings) => innings.overs.length > 0) && (
        <section aria-label="Scorecard" className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="font-semibold text-white">Scorecard</h3>
          {view.innings.map((innings) => (
            <div key={innings.innings} className="space-y-2">
              <p className="text-sm text-gray-300">Innings {innings.innings}: {innings.battingTeam}</p>
              <ol className="space-y-1">
                {innings.overs.map((over) => (
                  <li key={over.number} className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="w-16 shrink-0 text-gray-400">Over {over.number}</span>
                    {over.balls.map((ball, index) => (
                      <button key={ball.id} type="button" disabled={!canCorrect || busy}
                        aria-label={`Correct innings ${innings.innings}, over ${over.number}, ball ${index + 1}: ${ball.label}`}
                        onClick={() => setEditing({ ball, innings: innings.innings, over: over.number, position: index + 1 })}
                        className={`rounded-lg px-2 py-1 font-mono ${editing?.ball.id === ball.id ? 'bg-amber-500/30 text-amber-100' : 'bg-gray-800 text-white hover:bg-gray-700'} disabled:hover:bg-gray-800`}>
                        {ball.label}
                      </button>
                    ))}
                    <span className="ml-2 text-xs text-gray-500">{over.runs} run{over.runs === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {editing && canCorrect && (
            <div role="group" aria-label="Correct a ball" className="space-y-3 rounded-xl border border-amber-400/30 bg-gray-900/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-white">
                  <Pencil className="mr-1 inline h-4 w-4" />
                  Innings {editing.innings}, over {editing.over}, ball {editing.position}: was <span className="font-mono">{editing.ball.label}</span>. What really happened?
                </p>
                <button type="button" onClick={() => setEditing(null)} aria-label="Cancel the correction" className="rounded-lg p-1 text-gray-400 hover:bg-white/10">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <DeliveryPad key={editing.ball.id} busy={busy} initial={editing.ball} label=" (correction)"
                onRuns={(runs, extra, wicket) => send({ type: 'correct_ball', ballId: editing.ball.id, runs, extra, wicket })} />
              <p className="text-xs text-gray-400">The scores, results and players&apos; right and wrong answers follow the corrected ball.</p>
            </div>
          )}
        </section>
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
