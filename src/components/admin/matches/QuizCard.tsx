'use client';

import { useState } from 'react';
import { Clock, Loader2, Pencil, Send, Sparkles, SkipForward, Undo2, X } from 'lucide-react';
import { PUSH_BALLS } from '@/lib/match-engine';
import type { DraftToSend, QuizLanguage, QuizView } from '@/lib/match-service';

type Question = QuizView['questions'][number];
type Wording = { text: string; textRomanUrdu: string };
// `base`: the wording and line before the line box was first changed, so every keystroke rewords from it
// (typing 10 passes through 1, which must not stick in the text)
type Edit = Wording & { line: number | null; base?: Wording & { line: number } };

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50';
const field = 'w-full rounded-xl border border-white/10 bg-gray-900/60 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none';

/**
 * `text` with its line `from` changed to `to`: the last time the number appears on its own, never where it
 * names the over ("over 9"). The lead-in comes first and may state the same number ("after 9 overs"), the
 * question with its line comes last.
 */
export function changeLine(text: string, from: number, to: number): string {
  const matches = [...text.matchAll(new RegExp(`(?<!over\\s)\\b${from}\\b`, 'gi'))];
  const last = matches[matches.length - 1];
  return last ? `${text.slice(0, last.index)}${to}${text.slice(last.index! + last[0].length)}` : text;
}

/** A question as it goes out, with its line whenever it has one (it may differ from the one it was written with) */
const toSend = (q: Question, value: Wording & { line: number | null }): DraftToSend =>
  ({ id: q.id, text: value.text, textRomanUrdu: value.textRomanUrdu, ...(value.line !== null ? { line: value.line } : {}) });

/** What the admin sees of a question: what players will see, in the match's language */
function Shown({ wording, language }: { wording: Wording; language: QuizLanguage }) {
  if (language === 'en') return <span className="block text-white">{wording.text}</span>;
  if (language === 'ur') return <span className="block text-white">{wording.textRomanUrdu}</span>;
  return (
    <>
      <span className="block text-white">{wording.textRomanUrdu}</span>
      <span className="block text-xs text-gray-400">{wording.text}</span>
    </>
  );
}

const WORDING_BADGE = {
  pending: { label: 'Gemini is wording it…', tone: 'bg-violet-500/20 text-violet-200' },
  ai: { label: 'Worded by Gemini', tone: 'bg-violet-500/20 text-violet-200' },
  built_in: { label: 'Built-in wording', tone: 'bg-white/10 text-gray-300' },
} as const;

/**
 * An over's quiz, waiting to go out (match mode): its questions about the over, the best ticked, in the
 * match's language. The admin ticks the ones that go out, can change a wording or its line, then either
 * sends the quiz now (on the ball being bowled) or picks the ball of the over before it to go out on and
 * queues it: it goes out when the scorer records that ball. In Auto it is queued for ball 1 already; the
 * admin can still send it now, or cancel and take it over. The server checks every wording keeps its over
 * and line (src/lib/match-wording.ts) and that the over hasn't started.
 */
export default function QuizCard({ quiz, language, busy, onSend, onQueue, onUnqueue, onSkip }: {
  quiz: QuizView;
  language: QuizLanguage;
  busy: boolean;
  onSend: (questions: DraftToSend[]) => Promise<boolean>;
  onQueue: (ball: number, questions: DraftToSend[]) => Promise<boolean>;
  onUnqueue: () => Promise<boolean>;
  onSkip: (ids: string[]) => Promise<boolean>;
}) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(quiz.questions.filter((q) => q.selected).map((q) => q.id)));
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [ball, setBall] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const queued = quiz.pushOn !== null;
  const current = (q: Question): Edit => edits[q.id] ?? { text: q.text, textRomanUrdu: q.textRomanUrdu, line: q.line };
  const edit = (q: Question, change: Partial<Edit>) => setEdits((all) => ({ ...all, [q.id]: { ...current(q), ...change } }));
  const setLine = (q: Question, value: string) => {
    const before = current(q);
    const line = Number.parseInt(value, 10);
    if (!Number.isInteger(line) || line < 1 || line > 36 || before.line === null) return;
    const base = before.base ?? { text: before.text, textRomanUrdu: before.textRomanUrdu, line: before.line };
    edit(q, { line, base, text: changeLine(base.text, base.line, line), textRomanUrdu: changeLine(base.textRomanUrdu, base.line, line) });
  };
  const toggle = (id: string) => {
    setProblem(null);
    setTicked((all) => {
      const next = new Set(all);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // A ball already bowled can't be picked: ball 1 once the over has started, ball 2-4 once it has that many
  // (an over that has started has its ball count)
  const passed = (n: number) => quiz.started && (n === 1 || quiz.ballsBowled! >= n);

  const picked = (): DraftToSend[] | null => {
    const chosen = quiz.questions.filter((q) => ticked.has(q.id));
    if (chosen.length === 0) {
      setProblem('Tick at least one question');
      return null;
    }
    return chosen.map((q) => toSend(q, current(q)));
  };
  const go = async () => {
    // Queued: it goes out as it was set
    const questions = queued ? quiz.questions.filter((q) => q.selected).map((q) => toSend(q, q)) : picked();
    if (!questions) return;
    if (ball !== null && !queued) await onQueue(ball, questions);
    else await onSend(questions);
  };

  const badge = WORDING_BADGE[quiz.wording];
  const when = quiz.during === null ? 'Goes out before the first ball'
    : quiz.started ? `Over ${quiz.during} is being bowled: ${quiz.ballsBowled} ball${quiz.ballsBowled === 1 ? '' : 's'} so far`
    : `Goes out during over ${quiz.during}`;
  const sendLabel = queued ? 'Send now' : ball !== null ? `Queue for ball ${ball}` : `Send now (${ticked.size})`;

  return (
    <section role="group" aria-label={`Over ${quiz.over} quiz`} className="space-y-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-white">Over {quiz.over} quiz</h3>
          <p className="text-xs text-gray-400">{when}</p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${badge.tone}`}>
          {quiz.wording === 'pending' ? <Loader2 className="h-3 w-3 animate-spin" /> : quiz.wording === 'ai' ? <Sparkles className="h-3 w-3" /> : null}
          {badge.label}
        </span>
      </div>
      {quiz.rebuilt && <p className="text-xs text-amber-200">Updated from the corrected score.</p>}

      <ul className="space-y-2">
        {quiz.questions.map((q, i) => {
          const value = current(q);
          const open = editing === q.id && !queued;
          return (
            <li key={q.id} className="rounded-xl border border-white/10 bg-gray-900/40 p-3">
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={queued ? q.selected : ticked.has(q.id)} disabled={busy || queued} onChange={() => toggle(q.id)}
                  aria-label={`Include question ${i + 1}`} className="mt-1 h-5 w-5 shrink-0 accent-emerald-500" />
                <div className="min-w-0 flex-1 text-sm"><Shown wording={value} language={language} /></div>
                <div className="flex shrink-0 items-center gap-1">
                  {q.best && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">Best</span>}
                  {!queued && (
                    <button type="button" onClick={() => setEditing(open ? null : q.id)} aria-label={`${open ? 'Close' : 'Edit'} question ${i + 1}`}
                      className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white">
                      {open ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>
              {open && (
                <div className="mt-3 space-y-2">
                  <label className="block space-y-1 text-xs text-gray-400">
                    <span>Roman Urdu</span>
                    <textarea rows={2} className={field} value={value.textRomanUrdu} onChange={(e) => edit(q, { textRomanUrdu: e.target.value, base: undefined })} />
                  </label>
                  <label className="block space-y-1 text-xs text-gray-400">
                    <span>English</span>
                    <textarea rows={2} className={field} value={value.text} onChange={(e) => edit(q, { text: e.target.value, base: undefined })} />
                  </label>
                  <div className="flex flex-wrap items-end gap-2">
                    {value.line !== null && (
                      <label className="space-y-1 text-xs text-gray-400">
                        <span className="block">Line</span>
                        <input type="number" min={1} max={36} className={`${field} w-20`} value={value.line} onChange={(e) => setLine(q, e.target.value)} />
                      </label>
                    )}
                    {(value.text !== q.builtIn.text || value.textRomanUrdu !== q.builtIn.textRomanUrdu || value.line !== q.builtIn.line) && (
                      <button type="button" onClick={() => edit(q, { ...q.builtIn, base: undefined })} className={`${button} bg-white/10 text-white hover:bg-white/15`}>
                        <Undo2 className="h-4 w-4" /> Built-in wording
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {queued ? (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-100">
          <Clock className="h-4 w-4 shrink-0" />
          Goes out on ball {quiz.pushOn} of over {quiz.during}{quiz.pushBy === 'auto' ? ' (Auto)' : ''}.
        </p>
      ) : quiz.during !== null && (
        <div role="group" aria-label="Push on ball" className="space-y-1.5">
          <p className="text-xs text-gray-400">Push on ball of over {quiz.during} (or send now)</p>
          <div className="grid grid-cols-4 gap-2">
            {PUSH_BALLS.map((n) => (
              <button key={n} type="button" disabled={busy || passed(n)} aria-pressed={ball === n} onClick={() => setBall(ball === n ? null : n)}
                aria-label={`Push on ball ${n}`}
                className={`${button} border ${ball === n ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100' : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10'}`}>
                {quiz.during}.{n}
              </button>
            ))}
          </div>
        </div>
      )}

      {problem && <p role="alert" className="text-sm text-red-300">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void go()} className={`${button} flex-1 bg-emerald-600 text-white hover:bg-emerald-700`}>
          {ball !== null && !queued ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />} {sendLabel}
        </button>
        {queued ? (
          <button type="button" disabled={busy} onClick={() => void onUnqueue()} className={`${button} bg-white/10 text-white hover:bg-white/15`}>
            <X className="h-4 w-4" /> Cancel
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void onSkip(quiz.questions.map((q) => q.id))} className={`${button} bg-white/10 text-white hover:bg-white/15`}>
            <SkipForward className="h-4 w-4" /> Skip
          </button>
        )}
      </div>
    </section>
  );
}
