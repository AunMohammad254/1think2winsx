export type PoolDraft = { kind: 'none' | '10' | '20' | 'custom'; custom: string };

export const NO_POOL: PoolDraft = { kind: 'none', custom: '' };

/** The percentage of entrants the API takes (0: don't pay the pool), or what is wrong with a custom value. */
export function toPoolPercent(draft: PoolDraft): { percent: number } | { error: string } {
  if (draft.kind === 'none') return { percent: 0 };
  if (draft.kind !== 'custom') return { percent: Number(draft.kind) };
  const percent = Number(draft.custom);
  if (draft.custom.trim() === '' || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return { error: 'Points pool: enter a percentage above 0 and up to 100' };
  }
  if (Math.round(percent * 100) !== percent * 100) return { error: 'Points pool: use at most two decimals' };
  return { percent };
}

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * How many of the earliest players get a share: the percentage of the entrants, rounded up as
 * settle_quiz does (the rounding to 6 decimals first keeps float noise from adding a place).
 */
export const poolPlaces = (entrants: number, percent: number) => Math.ceil(Math.round(entrants * percent * 1e4) / 1e6);

export function PoolEditor({
  pointsPool,
  entrants,
  draft,
  onChange,
  disabled,
}: {
  pointsPool: number;
  /** Players who got in (at most the entry limit) */
  entrants: number;
  draft: PoolDraft;
  onChange: (draft: PoolDraft) => void;
  disabled: boolean;
}) {
  if (pointsPool <= 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
        This quiz has no points pool. Set one on the quiz (Edit quiz → Points Pool) to give it to the first players who got in.
      </div>
    );
  }
  const parsed = toPoolPercent(draft);
  return (
    <div role="radiogroup" aria-label="Who gets the points pool" className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm font-medium text-white">Points pool ({fmt(pointsPool)} points): who gets it</p>
      <p className="mb-2 text-xs text-gray-400">
        A percentage of the players who got in. The earliest ones who scored above 0 share the whole pool in random amounts,
        on top of the rewards above.
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {([['none', 'Nobody'], ['10', 'First 10%'], ['20', 'First 20%'], ['custom', 'Custom']] as const).map(([kind, label]) => (
          <label key={kind} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-white">
            <input type="radio" name="pool-share" value={kind} checked={draft.kind === kind} disabled={disabled}
              onChange={() => onChange({ ...draft, kind })} />
            {label}
          </label>
        ))}
        {draft.kind === 'custom' && (
          <label className="flex items-center gap-2 text-sm text-gray-300">
            First
            <input
              id="pool-share-custom"
              aria-label="Custom percentage of players"
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              inputMode="decimal"
              placeholder="e.g. 15"
              value={draft.custom}
              disabled={disabled}
              onChange={(e) => onChange({ ...draft, custom: e.target.value })}
              className="w-24 rounded-lg border border-white/10 bg-gray-900 px-3 py-1.5 text-sm text-white"
            />
            %
          </label>
        )}
      </div>
      {'percent' in parsed && parsed.percent > 0 && (
        <p className="mt-2 text-sm text-emerald-300">
          {entrants > 0
            ? `The first ${fmt(poolPlaces(entrants, parsed.percent))} of ${fmt(entrants)} players who got in share ${fmt(pointsPool)} points at random. Players who scored 0 don't take a place.`
            : 'Nobody has got in yet.'}
        </p>
      )}
    </div>
  );
}
