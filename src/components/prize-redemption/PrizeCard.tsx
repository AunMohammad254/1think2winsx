'use client';

import Image from 'next/image';
import type { Prize } from './types';

interface PrizeCardProps {
    prize: Prize;
    userPoints: number;
    isRedeeming: boolean;
    onPreview: (prize: Prize) => void;
    onRedeem: (prizeId: string, prizeName: string, pointsRequired: number) => void;
}

/**
 * Individual prize card in the grid
 */
export function PrizeCard({
    prize,
    userPoints,
    isRedeeming,
    onPreview,
    onRedeem,
}: PrizeCardProps) {
    const canAfford = userPoints >= prize.pointsRequired;

    return (
        <div className="glass-card-blue glass-border glass-hover glass-transition overflow-hidden rounded-2xl">
            <div
                className="h-48 bg-gradient-glass-dark flex items-center justify-center cursor-pointer hover:bg-white/5 transition-colors p-4"
                onClick={() => onPreview(prize)}
            >
                <div className="h-32 w-32 rounded-2xl overflow-hidden">
                    <Image
                        src={prize.imageUrl || `/prizes/${prize.type}.svg`}
                        alt={prize.name}
                        width={128}
                        height={128}
                        className="h-full w-full object-cover"
                    />
                </div>
            </div>
            <div className="p-4">
                <h3 className="text-lg font-semibold text-white mb-2 truncate" title={prize.name}>
                    {prize.name}
                </h3>
                <p className="text-sm text-gray-300 mb-3 line-clamp-2" title={prize.description}>
                    {prize.description}
                </p>
                <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-blue-400">
                        {prize.pointsRequired} points
                    </span>
                    <button
                        onClick={() => onRedeem(prize.id, prize.name, prize.pointsRequired)}
                        disabled={!canAfford || isRedeeming}
                        className={`px-4 py-2 rounded-md text-sm font-medium glass-transition ${canAfford && !isRedeeming
                                ? 'bg-blue-600 text-white hover:bg-blue-500 glass-hover-blue'
                                : 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        {isRedeeming ? 'Redeeming...' : canAfford ? 'Redeem' : 'Not enough points'}
                    </button>
                </div>
            </div>
        </div>
    );
}
