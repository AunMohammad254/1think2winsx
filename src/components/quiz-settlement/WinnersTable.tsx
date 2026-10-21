import type { SettledWinner } from '@/lib/quiz-settlement';

const PLACE = ['', '🥇 1st', '🥈 2nd', '🥉 3rd'];
const TIE_NOTE: Record<string, string> = {
  ranked_random_tiebreak: 'won a tie by random draw',
  ranked_earliest_tiebreak: 'won a tie by answering first',
  random_draw: 'lucky draw',
};

/** Places with their winner and reward: used for the preview and for a settled quiz. */
export function WinnersTable({
  winners,
  unfilled = [],
}: {
  winners: Array<SettledWinner & { tiedWith?: number }>;
  unfilled?: number[];
}) {
  if (winners.length === 0 && unfilled.length === 0) {
    return <p className="text-sm text-gray-400">No rewards were set for this quiz.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-gray-400">
          <tr>
            <th className="py-2 pr-4">Place</th>
            <th className="py-2 pr-4">Player</th>
            <th className="py-2 pr-4">Score</th>
            <th className="py-2">Reward</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {winners.map((w) => (
            <tr key={w.rank}>
              <td className="py-2 pr-4 text-white">{PLACE[w.rank]}</td>
              <td className="py-2 pr-4">
                <span className="block text-white">{w.name || 'Player'}</span>
                {w.email && <span className="block text-xs text-gray-400">{w.email}</span>}
                {TIE_NOTE[w.selectionMethod] && (
                  <span className="block text-xs text-amber-300">
                    {TIE_NOTE[w.selectionMethod]}{w.tiedWith ? ` (tied with ${w.tiedWith})` : ''}
                  </span>
                )}
              </td>
              <td className="py-2 pr-4 text-gray-200">{w.score}%</td>
              <td className="py-2 text-gray-200">
                {w.prizeName
                  ? <>{w.prizeCategory === 'bumper' ? '🎁 ' : '🏆 '}{w.prizeName}</>
                  : `${w.points} points`}
              </td>
            </tr>
          ))}
          {unfilled.map((rank) => (
            <tr key={`empty-${rank}`}>
              <td className="py-2 pr-4 text-white">{PLACE[rank]}</td>
              <td colSpan={3} className="py-2 text-gray-400">No player scored high enough for this place, so it isn&apos;t paid.</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
