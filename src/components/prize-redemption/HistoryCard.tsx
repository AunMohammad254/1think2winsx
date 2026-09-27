'use client';

import Image from 'next/image';
import { getStatusColor, type RedemptionHistory } from './types';

interface HistoryCardProps {
    redemption: RedemptionHistory;
    onPreview: (redemption: RedemptionHistory) => void;
}

/**
 * Card for redemption history items
 */
export function HistoryCard({ redemption, onPreview }: HistoryCardProps) {
    return (
        <div className="glass-card glass-border p-4 glass-hover glass-transition rounded-2xl">
            <div className="flex items-start justify-between">
                <div className="flex items-center space-x-4">
                    <div
                        className="h-16 w-16 bg-gradient-glass-dark rounded-xl overflow-hidden glass-border cursor-pointer hover:bg-white/5 transition-colors"
                        onClick={() => onPreview(redemption)}
                    >
                        <Image
                            src={redemption.prize.imageUrl || `/prizes/${redemption.prize.type}.svg`}
                            alt={redemption.prize.name}
                            width={48}
                            height={48}
                            className="h-full w-full object-cover"
                        />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-white truncate" title={redemption.prize.name}>
                            {redemption.prize.name}
                        </h3>
                        <p className="text-sm text-gray-300 line-clamp-2" title={redemption.prize.description}>
                            {redemption.prize.description}
                        </p>
                        <p className="text-sm text-gray-400 mt-1">
                            Requested on {new Date(redemption.requestedAt).toLocaleDateString()}
                        </p>
                    </div>
                </div>
                <div className="text-right">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(redemption.status)}`}>
                        {redemption.status.charAt(0).toUpperCase() + redemption.status.slice(1)}
                    </span>
                    <p className="text-sm text-gray-300 mt-1">{redemption.pointsUsed} points</p>
                </div>
            </div>
            {redemption.notes && (
                <div className="mt-3 p-3 bg-gradient-glass-dark rounded-md glass-border">
                    <p className="text-sm text-gray-300">{redemption.notes}</p>
                </div>
            )}
        </div>
    );
}
