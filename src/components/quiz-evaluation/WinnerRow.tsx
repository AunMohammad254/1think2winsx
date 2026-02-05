import type { Winner } from './types';

// Winner Row Component
export const WinnerRow = ({ winner, rank }: { winner: Winner; rank: number }) => {
    const medals = ['🥇', '🥈', '🥉'];

    return (
        <tr className="border-b border-white/10 hover:bg-white/5 transition-colors">
            <td className="py-3 px-4">
                <span className="text-2xl">{medals[rank - 1] || `#${rank}`}</span>
            </td>
            <td className="py-3 px-4">
                <div>
                    <div className="font-medium text-white">{winner.userName || 'Anonymous'}</div>
                    <div className="text-xs text-gray-400">{winner.userEmail}</div>
                </div>
            </td>
            <td className="py-3 px-4 text-center">
                <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 font-medium">
                    {winner.score}%
                </span>
            </td>
            <td className="py-3 px-4 text-center">
                <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-300 font-bold">
                    +{winner.pointsAwarded} pts
                </span>
            </td>
        </tr>
    );
};
