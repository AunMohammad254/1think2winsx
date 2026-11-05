'use client';

import { Controller, type Control } from 'react-hook-form';
import { ChevronDown, Trophy } from 'lucide-react';
import type { QuizFormData } from '@/lib/schemas/QuizFormSchema';

export interface PrizeOption {
    id: string;
    name: string;
    description: string | null;
}

interface PrizeLinkSectionProps {
    control: Control<QuizFormData>;
    isOpen: boolean;
    onToggle: () => void;
    prizes: PrizeOption[];
    watchedPrizeId: QuizFormData['prizeId'];
}

/** Optional, collapsible card that links the quiz to a prize and marks a bumper draw. */
export default function PrizeLinkSection({ control, isOpen, onToggle, prizes, watchedPrizeId }: PrizeLinkSectionProps) {
    return (
        <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        watchedPrizeId ? 'bg-yellow-500/20' : 'bg-gray-700/50'
                    }`}>
                        <Trophy className={`w-4 h-4 ${watchedPrizeId ? 'text-yellow-400' : 'text-gray-500'}`} />
                    </div>
                    <div className="text-left">
                        <p className="text-white font-medium text-sm">Link to Prize</p>
                        <p className="text-gray-500 text-xs">
                            {watchedPrizeId
                                ? `Prize linked: ${prizes.find(p => p.id === watchedPrizeId)?.name ?? watchedPrizeId}`
                                : 'Optional: shows this prize on the quiz card. You award prizes when you settle the quiz'}
                        </p>
                    </div>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="px-5 pb-5 space-y-4 border-t border-white/5">
                    <div className="pt-4">
                        <label className="block text-sm font-medium text-gray-300 mb-2">Select Prize</label>
                        <Controller
                            name="prizeId"
                            control={control}
                            render={({ field }) => (
                                <select
                                    value={field.value ?? ''}
                                    onChange={e => field.onChange(e.target.value || null)}
                                    className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/25 transition-all"
                                >
                                    <option value="">— No prize (regular quiz) —</option>
                                    {prizes.map(prize => (
                                        <option key={prize.id} value={prize.id}>{prize.name}</option>
                                    ))}
                                </select>
                            )}
                        />
                        {prizes.length === 0 && (
                            <p className="text-xs text-gray-500 mt-1">No active prizes found. Create a prize in Prize Management first.</p>
                        )}
                    </div>

                    <Controller
                        name="isBumperPrize"
                        control={control}
                        render={({ field }) => (
                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <div
                                    onClick={() => field.onChange(!field.value)}
                                    className={`w-10 h-6 rounded-full transition-all flex-shrink-0 ${
                                        field.value ? 'bg-yellow-500' : 'bg-gray-700'
                                    } relative`}
                                >
                                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${
                                        field.value ? 'left-5' : 'left-1'
                                    }`} />
                                </div>
                                <div>
                                    <p className="text-white text-sm font-medium">Bumper Prize</p>
                                    <p className="text-gray-500 text-xs">Mark as a special bumper prize draw</p>
                                </div>
                            </label>
                        )}
                    />
                </div>
            )}
        </div>
    );
}
