import type { SettlementPrize, TieRule } from '@/lib/quiz-settlement';

export type RewardDraft = { kind: 'none' | 'points' | 'prize'; points: string; prizeId: string };

export const EMPTY_REWARD: RewardDraft = { kind: 'none', points: '', prizeId: '' };
export const PLACES = ['1st place', '2nd place', '3rd place'];

/** Turn the editor rows into the API's rewards, or say what is missing. */
export function toRewards(drafts: RewardDraft[]): { rewards: Array<{ rank: number; points?: number; prizeId?: string }> } | { error: string } {
  const rewards: Array<{ rank: number; points?: number; prizeId?: string }> = [];
  for (const [i, d] of drafts.entries()) {
    if (d.kind === 'points') {
      const points = Number(d.points);
      if (!Number.isInteger(points) || points < 1 || points > 100_000) return { error: `${PLACES[i]}: enter 1 to 100,000 points` };
      rewards.push({ rank: i + 1, points });
    } else if (d.kind === 'prize') {
      if (!d.prizeId) return { error: `${PLACES[i]}: choose a prize` };
      rewards.push({ rank: i + 1, prizeId: d.prizeId });
    }
  }
  return { rewards };
}

export function RewardsEditor({
  drafts,
  prizes,
  tieRule,
  onChange,
  onTieRule,
  disabled,
}: {
  drafts: RewardDraft[];
  prizes: SettlementPrize[];
  tieRule: TieRule;
  onChange: (index: number, draft: RewardDraft) => void;
  onTieRule: (rule: TieRule) => void;
  disabled: boolean;
}) {
  const bumper = prizes.filter((p) => p.category === 'bumper');
  const catalogue = prizes.filter((p) => p.category !== 'bumper');
  const option = (p: SettlementPrize) => (
    <option key={p.id} value={p.id} disabled={p.stock <= 0}>
      {p.name} ({p.stock > 0 ? `${p.stock} in stock` : 'out of stock'})
    </option>
  );

  return (
    <div className="space-y-4">
      {drafts.map((d, i) => (
        <fieldset key={i} className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[8rem_10rem_1fr] sm:items-center">
          <legend className="sr-only">{PLACES[i]} reward</legend>
          <span className="font-semibold text-white">{['🥇', '🥈', '🥉'][i]} {PLACES[i]}</span>
          <select
            aria-label={`${PLACES[i]} reward type`}
            value={d.kind}
            disabled={disabled}
            onChange={(e) => onChange(i, { ...EMPTY_REWARD, kind: e.target.value as RewardDraft['kind'] })}
            className="rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white"
          >
            <option value="none">No reward</option>
            <option value="points">Points</option>
            <option value="prize">A prize</option>
          </select>
          {d.kind === 'points' && (
            <input
              aria-label={`${PLACES[i]} points`}
              type="number"
              min={1}
              max={100000}
              inputMode="numeric"
              placeholder="e.g. 500"
              value={d.points}
              disabled={disabled}
              onChange={(e) => onChange(i, { ...d, points: e.target.value })}
              className="rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white"
            />
          )}
          {d.kind === 'prize' && (
            <select
              aria-label={`${PLACES[i]} prize`}
              value={d.prizeId}
              disabled={disabled}
              onChange={(e) => onChange(i, { ...d, prizeId: e.target.value })}
              className="rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white"
            >
              <option value="">Choose a prize…</option>
              {bumper.length > 0 && <optgroup label="🎁 Bumper prizes (secret: only the winner sees it)">{bumper.map(option)}</optgroup>}
              {catalogue.length > 0 && <optgroup label="Prize catalogue">{catalogue.map(option)}</optgroup>}
            </select>
          )}
          {d.kind === 'none' && <span className="text-sm text-gray-500">Nothing for this place</span>}
        </fieldset>
      ))}

      <div role="radiogroup" aria-label="How to break a tie" className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="mb-2 text-sm font-medium text-white">When players tie for a place</p>
        {([
          ['random', 'Fair random draw', 'Tied players are ordered by a recorded draw anyone can re-check.'],
          ['earliest', 'Earliest submission', 'The tied player who answered first wins.'],
        ] as const).map(([rule, label, hint]) => (
          <label key={rule} className="flex cursor-pointer items-start gap-3 py-1.5">
            <input type="radio" name="tie-rule" value={rule} checked={tieRule === rule} disabled={disabled} onChange={() => onTieRule(rule)} className="mt-1" />
            <span>
              <span className="block text-sm text-white">{label}</span>
              <span className="block text-xs text-gray-400">{hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
