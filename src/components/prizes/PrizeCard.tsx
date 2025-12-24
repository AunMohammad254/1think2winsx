'use client';

import Image from 'next/image';
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Prize } from '@/types/prize';

interface PrizeCardProps {
    prize: Prize;
    userPoints?: number;
    onRedeem?: (prize: Prize) => void;
    isRedeeming?: boolean;
    variant?: 'default' | 'featured' | 'compact';
}

export default function PrizeCard({
    prize,
    userPoints = 0,
    onRedeem,
    isRedeeming = false,
    variant = 'default',
}: PrizeCardProps) {
    const [imageError, setImageError] = useState(false);
    const canRedeem = userPoints >= prize.pointsRequired && prize.stock > 0;
    const isOutOfStock = prize.stock <= 0;

    // Category badge colors
    const categoryColors: Record<string, { bg: string; text: string }> = {
        electronics: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
        vehicles: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
        accessories: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
        general: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
    };

    const categoryStyle = categoryColors[prize.category] || categoryColors.general;

    // Card size variants
    const sizeClasses = {
        default: 'col-span-1',
        featured: 'col-span-1 md:col-span-2 row-span-2',
        compact: 'col-span-1',
    };

    return (
        <motion.div
            className={`group relative ${sizeClasses[variant]}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            whileHover={{ y: -4 }}
        >
            <div className="relative h-full overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800/90 to-slate-900/90 border border-white/10 backdrop-blur-sm shadow-xl transition-all duration-300 group-hover:border-white/20 group-hover:shadow-2xl">
                {/* Image Section */}
                <div className={`relative ${variant === 'featured' ? 'h-64' : 'h-48'} overflow-hidden bg-gradient-to-br from-slate-700/50 to-slate-800/50`}>
                    {prize.imageUrl && !imageError ? (
                        <Image
                            src={prize.imageUrl}
                            alt={prize.name}
                            fill
                            className="object-contain p-4 transition-transform duration-500 group-hover:scale-110"
                            onError={() => setImageError(true)}
                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-6xl opacity-50">🎁</div>
                        </div>
                    )}

                    {/* Category Badge */}
                    <div className={`absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-medium ${categoryStyle.bg} ${categoryStyle.text} border border-white/10`}>
                        {prize.category.charAt(0).toUpperCase() + prize.category.slice(1)}
                    </div>

                    {/* Stock Badge */}
                    {isOutOfStock && (
                        <div className="absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                            Out of Stock
                        </div>
                    )}

                    {/* Value Badge */}
                    {prize.value > 0 && (
                        <div className="absolute bottom-3 right-3 px-3 py-1 rounded-full text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                            PKR {prize.value.toLocaleString()}
                        </div>
                    )}
                </div>

                {/* Content Section */}
                <div className="p-5 space-y-4">
                    {/* Title & Description */}
                    <div className="space-y-2">
                        <h3 className="text-lg font-bold text-white line-clamp-1 group-hover:text-blue-400 transition-colors">
                            {prize.name}
                        </h3>
                        {prize.description && (
                            <p className="text-sm text-gray-400 line-clamp-2">
                                {prize.description}
                            </p>
                        )}
                    </div>

                    {/* Points Required */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
                                <span className="text-xs">⭐</span>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Points Required</p>
                                <p className="text-lg font-bold text-yellow-400">
                                    {prize.pointsRequired.toLocaleString()}
                                </p>
                            </div>
                        </div>

                        {/* Stock Indicator */}
                        {prize.stock > 0 && prize.stock <= 5 && (
                            <div className="text-xs text-orange-400">
                                Only {prize.stock} left!
                            </div>
                        )}
                    </div>

                    {/* User Points Comparison */}
                    {userPoints > 0 && (
                        <div className="relative h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${canRedeem ? 'bg-gradient-to-r from-green-500 to-emerald-400' : 'bg-gradient-to-r from-blue-500 to-purple-500'
                                    }`}
                                style={{ width: `${Math.min((userPoints / prize.pointsRequired) * 100, 100)}%` }}
                            />
                        </div>
                    )}

                    {/* Redeem Button */}
                    <button
                        onClick={() => onRedeem?.(prize)}
                        disabled={!canRedeem || isRedeeming || isOutOfStock}
                        className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center justify-center gap-2 ${canRedeem && !isRedeeming && !isOutOfStock
                                ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 hover:shadow-lg hover:shadow-blue-500/25 active:scale-[0.98]'
                                : 'bg-slate-700 text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        {isRedeeming ? (
                            <>
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Processing...
                            </>
                        ) : isOutOfStock ? (
                            'Out of Stock'
                        ) : canRedeem ? (
                            <>
                                <span>🎁</span>
                                Redeem Now
                            </>
                        ) : (
                            `Need ${(prize.pointsRequired - userPoints).toLocaleString()} more points`
                        )}
                    </button>
                </div>

                {/* Hover Glow Effect */}
                <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                    <div className="absolute inset-0 bg-gradient-to-t from-blue-500/10 to-transparent" />
                </div>
            </div>
        </motion.div>
    );
}
