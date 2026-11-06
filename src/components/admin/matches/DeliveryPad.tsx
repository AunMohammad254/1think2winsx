'use client';

import { useState } from 'react';
import {
  deliveryProblem, DISMISSALS_FOR, NO_RUN_DISMISSALS, type Delivery, type Extra, type WicketKind,
} from '@/lib/match-engine';
import type { ViewBall } from '@/lib/match-service';

/** The kinds of delivery the scorer picks from; a no-ball's runs are off the bat, byes or leg byes */
type Kind = 'none' | 'wide' | 'no_ball' | 'bye' | 'leg_bye';
type NoBallRuns = 'no_ball' | 'no_ball_bye' | 'no_ball_leg_bye';

const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'none', label: 'Normal' },
  { value: 'wide', label: 'Wide' },
  { value: 'no_ball', label: 'No-ball' },
  { value: 'bye', label: 'Bye' },
  { value: 'leg_bye', label: 'Leg bye' },
];
const NO_BALL_RUNS: Array<{ value: NoBallRuns; label: string }> = [
  { value: 'no_ball', label: 'Off the bat' },
  { value: 'no_ball_bye', label: 'Byes' },
  { value: 'no_ball_leg_bye', label: 'Leg byes' },
];
const OUTS: Array<{ kind: WicketKind; label: string }> = [
  { kind: 'bowled', label: 'Bowled' },
  { kind: 'caught', label: 'Caught' },
  { kind: 'lbw', label: 'LBW' },
  { kind: 'stumped', label: 'Stumped' },
  { kind: 'hit_wicket', label: 'Hit wicket' },
  { kind: 'run_out', label: 'Run out' },
  { kind: 'obstructing', label: 'Obstructing' },
  { kind: 'hit_twice', label: 'Hit twice' },
];

interface RunButton { runs: number; boundary: boolean | null; text: string; name: string }
const plural = (runs: number) => `${runs} run${runs === 1 ? '' : 's'}`;
// Four and Six are boundaries; "4 ran" and "6 ran" are runs completed or overthrows, which aren't
const MAIN_RUNS: RunButton[] = [0, 1, 2, 3].map((runs) => ({ runs, boundary: null, text: String(runs), name: plural(runs) }));
const BOUNDARIES: RunButton[] = [
  { runs: 4, boundary: true, text: 'FOUR', name: 'Four' },
  { runs: 6, boundary: true, text: 'SIX', name: 'Six' },
];
const MORE_RUNS: RunButton[] = [
  { runs: 4, boundary: false, text: '4 ran', name: '4 runs, ran' },
  { runs: 5, boundary: null, text: '5', name: '5 runs' },
  { runs: 6, boundary: false, text: '6 ran', name: '6 runs, ran' },
  { runs: 7, boundary: null, text: '7', name: '7 runs' },
];

const base = 'inline-flex items-center justify-center rounded-xl text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30';
const chip = (on: boolean, tone: 'plain' | 'out' = 'plain') => `${base} min-h-10 border px-3 ${on
  ? tone === 'out' ? 'border-red-400 bg-red-500/25 text-red-100' : 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
  : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'}`;

/** The pad's choices: the delivery, a no-ball's runs, and a dismissal waiting for its runs (Run out, Obstructing) */
interface PadState { kind: Kind; noBallRuns: NoBallRuns; armed: WicketKind | null }

function startFrom(initial: Pick<ViewBall, 'extra' | 'wicket' | 'wicketKind'> | undefined): PadState {
  const extra = initial?.extra ?? 'none';
  const kind: Kind = extra.startsWith('no_ball') ? 'no_ball' : (KINDS.some((k) => k.value === extra) ? extra as Kind : 'none');
  const armed = initial?.wicket && (initial.wicketKind === 'run_out' || initial.wicketKind === 'obstructing') ? initial.wicketKind : null;
  return { kind, noBallRuns: (extra.startsWith('no_ball') ? extra : 'no_ball') as NoBallRuns, armed };
}

/**
 * Every scoring action of the Laws of Cricket, in as few taps as a scorer has between balls:
 *  - the kind of delivery (Normal, Wide, No-ball and whether its runs were off the bat or byes, Bye, Leg bye),
 *    then the runs, which record it: 0-3, FOUR and SIX (boundaries), 4 ran, 5, 6 ran and 7 (runs completed
 *    and overthrows). For a wide or no-ball, the runs are those on top of its 1 extra run;
 *  - Out: the dismissals that delivery allows. One with no runs records at once; Run out and Obstructing
 *    then take the runs completed;
 *  - Other: 5 penalty runs to the batting side, Retired out and Timed out, none of them a ball of the over.
 * A choice the Laws don't allow can't be tapped (src/lib/match-engine.ts deliveryProblem). Shared by
 * recording a ball and correcting one (`initial`: what was recorded).
 */
export default function DeliveryPad({ busy, onRecord, initial, label }: {
  busy: boolean;
  /** Resolves true once saved */
  onRecord: (delivery: Delivery) => Promise<boolean>;
  initial?: Pick<ViewBall, 'extra' | 'wicket' | 'wicketKind'>;
  /** Added to every button's name: " (correction)" for the correction pad */
  label: string;
}) {
  const [state, setState] = useState(() => startFrom(initial));
  const extra: Extra = state.kind === 'no_ball' ? state.noBallRuns : state.kind;
  const set = (change: Partial<PadState>) => setState((s) => ({ ...s, ...change }));

  const record = async (delivery: Delivery) => {
    // Saved: back to a normal ball for the next one. Not saved: the choice stays, to try again
    if (await onRecord(delivery)) setState(startFrom(undefined));
  };
  const withRuns = (b: RunButton): Delivery => ({
    runs: b.runs, extra, wicket: state.armed !== null,
    ...(state.armed ? { wicketKind: state.armed } : {}),
    ...(b.boundary !== null ? { boundary: b.boundary } : {}),
  });
  const runButton = (b: RunButton, size: string) => (
    <button key={b.name} type="button" disabled={busy || deliveryProblem(withRuns(b)) !== null} onClick={() => void record(withRuns(b))}
      aria-label={`${b.name}${label}`}
      className={`${base} ${size} ${b.boundary ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-gray-800 text-white hover:bg-gray-700'}`}>
      {b.text}
    </button>
  );
  const out = (kind: WicketKind) => {
    if (NO_RUN_DISMISSALS.includes(kind)) void record({ runs: 0, extra, wicket: true, wicketKind: kind });
    else set({ armed: state.armed === kind ? null : kind });
  };

  return (
    <div className="space-y-3">
      <div role="group" aria-label={`Kind of delivery${label}`} className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k.value} type="button" aria-pressed={state.kind === k.value} onClick={() => set({ kind: k.value, armed: null })} className={chip(state.kind === k.value)}>
            {k.label}
          </button>
        ))}
      </div>
      {state.kind === 'no_ball' && (
        <div role="group" aria-label={`No-ball runs${label}`} className="flex flex-wrap gap-2">
          {NO_BALL_RUNS.map((n) => (
            <button key={n.value} type="button" aria-pressed={state.noBallRuns === n.value} onClick={() => set({ noBallRuns: n.value, armed: null })} className={chip(state.noBallRuns === n.value)}>
              {n.label}
            </button>
          ))}
        </div>
      )}

      <div role="group" aria-label={`Runs${label}`} className="grid grid-cols-4 gap-2 sm:max-w-md">
        {MAIN_RUNS.map((b) => runButton(b, 'h-14 text-lg'))}
        {BOUNDARIES.map((b) => <div key={b.name} className="col-span-2 grid">{runButton(b, 'h-14 text-lg font-bold tracking-wide')}</div>)}
        {MORE_RUNS.map((b) => runButton(b, 'h-10'))}
      </div>

      <div role="group" aria-label={`Out${label}`} className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-red-300">Out</span>
        {OUTS.map((o) => (
          <button key={o.kind} type="button" disabled={busy || !DISMISSALS_FOR[extra].includes(o.kind)} aria-pressed={state.armed === o.kind}
            onClick={() => out(o.kind)} aria-label={`${o.label}${label}`} className={chip(state.armed === o.kind, 'out')}>
            {o.label}
          </button>
        ))}
      </div>
      {state.armed && (
        <p role="status" className="text-xs text-red-200">
          {state.armed === 'run_out' ? 'Run out' : 'Obstructing the field'}: now tap the runs completed before it (0 if none).
        </p>
      )}

      <div role="group" aria-label={`Other${label}`} className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void record({ runs: 0, extra: 'penalty', wicket: false })} aria-label={`+5 penalty runs${label}`} className={chip(false)}>
          +5 penalty runs
        </button>
        <button type="button" disabled={busy} onClick={() => void record({ runs: 0, extra: 'no_delivery', wicket: true, wicketKind: 'retired_out' })} aria-label={`Retired out${label}`} className={chip(false)}>
          Retired out
        </button>
        <button type="button" disabled={busy} onClick={() => void record({ runs: 0, extra: 'no_delivery', wicket: true, wicketKind: 'timed_out' })} aria-label={`Timed out${label}`} className={chip(false)}>
          Timed out
        </button>
      </div>
    </div>
  );
}
