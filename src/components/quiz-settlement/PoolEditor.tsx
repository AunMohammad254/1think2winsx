export type PoolDraft = { kind: 'none' | '10' | '20' | 'custom'; custom: string };

export const NO_POOL: PoolDraft = { kind: 'none', custom: '' };

/** The pool share the API takes (0 for none), or what is wrong with a custom value. */
export function toPoolPercent(draft: PoolDraft): { percent: number } | { error: string } {
  if (draft.kind === 'none') return { percent: 0 };
  if (draft.kind !== 'custom') return { percent: Number(draft.kind) };
  const percent = Number(draft.custom);
  if (draft.custom.trim() === '' || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return { error: 'Points pool: enter a share above 0 and up to 100 percent' };
  }
  if (Math.round(percent * 100) !== percent * 100) return { error: 'Points pool: use at most two decimals' };
  return { percent };
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** Points the share comes to: the same rounding down settle_quiz does. */
export const poolTarget = (pointsPool: number, percent: number) => Math.floor((pointsPool * percent) / 100);

export function PoolEditor({
  pointsPool,
  draft,
  onChange,
  disabled,
}: {
  pointsPool: number;
  draft: PoolDraft;
  onChange: (draft: PoolDraft) => void;
  disabled: boolean;
}) {
  if (pointsPool <= 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
        This quiz has no points pool. Set one on the quiz (Edit quiz → Points Pool) to share points among the players who scored.
      </div>
    );
  }
  const parsed = toPoolPercent(draft);
  return (
    <div role="radiogroup" aria-label="Share of the points pool" className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm font-medium text-white">Share of the points pool ({fmt(pointsPool)} points)</p>
      <p className="mb-2 text-xs text-gray-400">
        Split in random amounts among the players who got in and scored above 0, on top of the rewards above.
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {([['none', 'None'], ['10', '10%'], ['20', '20%'], ['custom', 'Custom']] as const).map(([kind, label]) => (
          <label key={kind} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-white">
            <input type="radio" name="pool-share" value={kind} checked={draft.kind === kind} disabled={disabled}
              onChange={() => onChange({ ...draft, kind })} />
            {label}
          </label>
        ))}
        {draft.kind === 'custom' && (
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              id="pool-share-custom"
              aria-label="Custom pool share in percent"
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
          {fmt(poolTarget(pointsPool, parsed.percent))} points will be shared at random.
        </p>
      )}
    </div>
  );
}
