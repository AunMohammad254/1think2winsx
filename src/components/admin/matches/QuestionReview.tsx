'use client';

import { useState } from 'react';
import { Send, Sparkles, SkipForward, Undo2 } from 'lucide-react';
import { MIN_ANSWER_SECONDS } from '@/lib/match-engine';
import { formatClock } from '@/lib/live-countdown';
import type { MatchView } from '@/lib/match-service';
import type { DraftToSend } from '@/lib/match-service';

type Draft = MatchView['drafts'][number];
type Wording = { text: string; textRomanUrdu: string };
// `base`: the wording and line before the line box was first changed, so every keystroke rewords from it
// (typing 10 passes through 1, which must not stick in the text)
type Edit = Wording & { line: number | null; base?: Wording & { line: number } };

const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50';
const field = 'w-full rounded-xl border border-white/10 bg-gray-900/60 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none';

/** `text` with the number `from` (as a whole number) changed to `to`, except where it names the over ("over 9") */
export const changeLine = (text: string, from: number, to: number) => text.replace(new RegExp(`(?<!over\\s)\\b${from}\\b`, 'gi'), String(to));

/**
 * The over questions waiting for an admin (match mode): worded by Gemini or the built-in templates, in
 * Roman Urdu (players see it first) and English. Each can be edited, its line changed, put back to the
 * built-in wording, sent or skipped; players see nothing until it is sent. The server checks every
 * wording keeps its over and line (src/lib/match-wording.ts) and that the over hasn't started.
 */
export default function QuestionReview({ drafts, now, busy, onSend, onSkip }: {
  drafts: Draft[];
  now: number;
  busy: boolean;
  onSend: (questions: DraftToSend[]) => Promise<boolean>;
  onSkip: (ids: string[]) => Promise<boolean>;
}) {
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const waiting = drafts.filter((d) => d.state === 'waiting');
  const lapsed = drafts.filter((d) => d.state === 'too_late');
  if (waiting.length === 0 && lapsed.length === 0) return null;

  const current = (draft: Draft): Edit => edits[draft.id] ?? { text: draft.text, textRomanUrdu: draft.textRomanUrdu, line: draft.line };
  const edit = (draft: Draft, change: Partial<Edit>) => setEdits((all) => ({ ...all, [draft.id]: { ...current(draft), ...change } }));
  const setLine = (draft: Draft, value: string) => {
    const before = current(draft);
    const line = Number.parseInt(value, 10);
    if (!Number.isInteger(line) || line < 1 || line > 36 || before.line === null) return;
    const base = before.base ?? { text: before.text, textRomanUrdu: before.textRomanUrdu, line: before.line };
    edit(draft, { line, base, text: changeLine(base.text, base.line, line), textRomanUrdu: changeLine(base.textRomanUrdu, base.line, line) });
  };
  const forget = (ids: string[]) => setEdits((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !ids.includes(id))));
  const send = async (group: Draft[]) => {
    const questions = group.map((draft) => {
      const { text, textRomanUrdu, line } = current(draft);
      return { id: draft.id, text, textRomanUrdu, ...(line !== null && line !== draft.line ? { line } : {}) };
    });
    if (await onSend(questions)) forget(group.map((d) => d.id));
  };
  const skip = async (group: Draft[]) => {
    if (await onSkip(group.map((d) => d.id))) forget(group.map((d) => d.id));
  };

  const overs = [...new Set(waiting.map((d) => `${d.innings}.${d.over}`))].map((key) => waiting.filter((d) => `${d.innings}.${d.over}` === key));

  return (
    <section aria-label="Review questions" className="space-y-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-6">
      <div>
        <h3 className="font-semibold text-white">Questions waiting for you</h3>
        <p className="text-xs text-gray-400">Players see nothing until you send. Check the wording, change it if needed, then send or skip.</p>
      </div>
      {overs.map((group) => {
        const { over } = group[0];
        // Sending needs time left for players to answer
        const left = Math.min(...group.map((d) => Date.parse(d.closesAt))) - now - MIN_ANSWER_SECONDS * 1000;
        return (
          <div key={`${group[0].innings}.${over}`} role="group" aria-label={`Over ${over} questions`} className="space-y-3 rounded-xl border border-white/10 bg-gray-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-white">Over {over}</p>
              <p className={`text-xs ${left < 30_000 ? 'text-red-300' : 'text-amber-200'}`}>
                Send within {formatClock(left)}, {over === 1 ? 'and before over 1 starts' : `and before the 5th ball of over ${over - 1}`}
              </p>
            </div>
            {group.map((draft, i) => {
              const value = current(draft);
              const changed = value.text !== draft.plainText || value.textRomanUrdu !== draft.plainTextRomanUrdu || value.line !== draft.line;
              return (
                <div key={draft.id} className="space-y-2 border-t border-white/5 pt-3 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-gray-400">Question {i + 1}</span>
                    <span className={`rounded-full px-2 py-0.5 ${draft.ai ? 'bg-violet-500/20 text-violet-200' : 'bg-white/10 text-gray-300'}`}>
                      {draft.ai ? <><Sparkles className="mr-1 inline h-3 w-3" />Worded by Gemini: check it</> : 'Built-in wording'}
                    </span>
                  </div>
                  <label className="block space-y-1 text-xs text-gray-400">
                    <span>Roman Urdu (players see this first)</span>
                    <textarea rows={2} className={field} value={value.textRomanUrdu} onChange={(e) => edit(draft, { textRomanUrdu: e.target.value, base: undefined })} />
                  </label>
                  <label className="block space-y-1 text-xs text-gray-400">
                    <span>English</span>
                    <textarea rows={2} className={field} value={value.text} onChange={(e) => edit(draft, { text: e.target.value, base: undefined })} />
                  </label>
                  <div className="flex flex-wrap items-end gap-2">
                    {value.line !== null && (
                      <label className="space-y-1 text-xs text-gray-400">
                        <span className="block">Line</span>
                        <input type="number" min={1} max={36} className={`${field} w-20`} value={value.line} onChange={(e) => setLine(draft, e.target.value)} />
                      </label>
                    )}
                    {changed && (
                      <button type="button" disabled={busy} onClick={() => edit(draft, { text: draft.plainText, textRomanUrdu: draft.plainTextRomanUrdu, line: draft.line, base: undefined })}
                        className={`${button} bg-white/10 text-white hover:bg-white/15`}>
                        <Undo2 className="h-4 w-4" /> Built-in wording
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => void send([draft])} aria-label={`Send over ${over} question ${i + 1}`}
                      className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
                      <Send className="h-4 w-4" /> Send
                    </button>
                    <button type="button" disabled={busy} onClick={() => void skip([draft])} aria-label={`Skip over ${over} question ${i + 1}`}
                      className={`${button} bg-white/10 text-white hover:bg-white/15`}>
                      <SkipForward className="h-4 w-4" /> Skip
                    </button>
                  </div>
                </div>
              );
            })}
            {group.length > 1 && (
              <button type="button" disabled={busy} onClick={() => void send(group)} className={`${button} w-full bg-emerald-600 text-white hover:bg-emerald-700`}>
                <Send className="h-4 w-4" /> Send all {group.length} for over {over}
              </button>
            )}
          </div>
        );
      })}
      {lapsed.length > 0 && (
        <p className="text-xs text-gray-400">
          Ran out of time, never sent: over {[...new Set(lapsed.map((d) => d.over))].join(', ')}. Those overs have no questions.
        </p>
      )}
    </section>
  );
}
