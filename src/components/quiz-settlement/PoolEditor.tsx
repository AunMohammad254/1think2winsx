import { formatCount as fmt, hasAtMostTwoDecimals } from '@/lib/numbers';

/**
 * Who gets the points pool (`kind`: a percentage of the entrants) and how much each gets (`split`:
 * random shares of the whole pool, 1 point each, or a custom number of points each).
 */
export type PoolDraft = {
  kind: 'none' | '10' | '20' | 'custom';
  custom: string;
  split: 'random' | 'one' | 'each';
  each: string;
};

export const NO_POOL: PoolDraft = { kind: 'none', custom: '', split: 'random', each: '' };

/**
 * The percentage of entrants and the points each that the API takes (0 and 0: don't pay the pool;
 * each 0: random shares), or what is wrong with a custom value. Points each can't be above the pool.
 */
export function toPoolShare(draft: PoolDraft, pointsPool: number): { percent: number; each: number } | { error: string } {
  if (draft.kind === 'none') return { percent: 0, each: 0 };
  let percent = Number(draft.kind);
  if (draft.kind === 'custom') {
    percent = Number(draft.custom);
    if (draft.custom.trim() === '' || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return { error: 'Points pool: enter a percentage above 0 and up to 100' };
    }
    if (!hasAtMostTwoDecimals(percent)) return { error: 'Points pool: use at most two decimals' };
  }
  if (draft.split === 'random') return { percent, each: 0 };
  if (draft.split === 'one') return { percent, each: 1 };
  const each = Number(draft.each);
  if (draft.each.trim() === '' || !Number.isInteger(each) || each < 1 || each > pointsPool) {
    return { error: `Points pool: enter whole points each, 1 to ${fmt(pointsPool)}` };
  }
  return { percent, each };
}

/**
 * How many of the earliest players get a share: the percentage of the entrants, rounded up as
 * settle_quiz does (the rounding to 6 decimals first keeps float noise from adding a place). With
 * points each, never more places than the pool covers.
 */
export function poolPlaces(entrants: number, percent: number, each = 0, pointsPool = 0): number {
  const places = Math.ceil(Math.round(entrants * percent * 1e4) / 1e6);
  return each > 0 ? Math.min(places, Math.floor(pointsPool / each)) : places;
}

const points = (n: number) => `${fmt(n)} ${n === 1 ? 'point' : 'points'}`;

/** What the chosen share pays, in one sentence, for the line under the editor. */
function summary(pointsPool: number, entrants: number, share: { percent: number; each: number }): string {
  if (entrants === 0) return 'Nobody has got in yet.';
  const zero = " Players who scored 0 don't take a place.";
  if (share.each === 0) {
    return `The first ${fmt(poolPlaces(entrants, share.percent))} of ${fmt(entrants)} players who got in share ${fmt(pointsPool)} points at random.${zero}`;
  }
  const asked = poolPlaces(entrants, share.percent);
  const places = poolPlaces(entrants, share.percent, share.each, pointsPool);
  const capped = places < asked ? ` The pool covers ${fmt(places)} of the ${fmt(asked)} places at ${points(share.each)} each.` : '';
  return `The first ${fmt(places)} of ${fmt(entrants)} players who got in get ${points(share.each)} each: ` +
    `${fmt(places * share.each)} of the ${fmt(pointsPool)} pool points.${capped}${zero}`;
}

const radio = 'flex cursor-pointer items-center gap-2 py-1 text-sm text-white';
const numberInput = 'w-24 rounded-lg border border-white/10 bg-gray-900 px-3 py-1.5 text-sm text-white';

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
  const parsed = toPoolShare(draft, pointsPool);
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div role="radiogroup" aria-label="Who gets the points pool">
        <p className="text-sm font-medium text-white">Points pool ({fmt(pointsPool)} points): who gets it</p>
        <p className="mb-2 text-xs text-gray-400">
          A percentage of the players who got in: the earliest ones who scored above 0, on top of the rewards above.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {([['none', 'Nobody'], ['10', 'First 10%'], ['20', 'First 20%'], ['custom', 'Custom']] as const).map(([kind, label]) => (
            <label key={kind} className={radio}>
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
                className={numberInput}
              />
              %
            </label>
          )}
        </div>
      </div>

      {draft.kind !== 'none' && (
        <div role="radiogroup" aria-label="How much each player gets">
          <p className="mb-1 text-sm font-medium text-white">How much each gets</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {([['random', 'Share the whole pool at random'], ['one', '1 point each'], ['each', 'Custom points each']] as const).map(([split, label]) => (
              <label key={split} className={radio}>
                <input type="radio" name="pool-split" value={split} checked={draft.split === split} disabled={disabled}
                  onChange={() => onChange({ ...draft, split })} />
                {label}
              </label>
            ))}
            {draft.split === 'each' && (
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  aria-label="Points each player gets"
                  type="number"
                  min={1}
                  max={pointsPool}
                  step={1}
                  inputMode="numeric"
                  placeholder="e.g. 5"
                  value={draft.each}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...draft, each: e.target.value })}
                  className={numberInput}
                />
                points each
              </label>
            )}
          </div>
        </div>
      )}

      {'percent' in parsed && parsed.percent > 0 && (
        <p className="text-sm text-emerald-300">{summary(pointsPool, entrants, parsed)}</p>
      )}
    </div>
  );
}
