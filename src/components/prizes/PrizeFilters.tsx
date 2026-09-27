'use client';

import { PRIZE_CATEGORIES, SORT_OPTIONS } from '@/types/prize';
import type { PrizeCategory, PrizeSortOption } from '@/types/prize';

interface PrizeFiltersProps {
    selectedCategory: PrizeCategory;
    selectedSort: PrizeSortOption;
    onCategoryChange: (category: PrizeCategory) => void;
    onSortChange: (sort: PrizeSortOption) => void;
    totalPrizes?: number;
}

export default function PrizeFilters({
    selectedCategory,
    selectedSort,
    onCategoryChange,
    onSortChange,
    totalPrizes = 0,
}: PrizeFiltersProps) {
    return (
        <div className="space-y-4">
            {/* Category Filters */}
            <div className="flex flex-wrap gap-2">
                {PRIZE_CATEGORIES.map((category) => (
                    <button
                        key={category.value}
                        onClick={() => onCategoryChange(category.value)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 flex items-center gap-2 ${selectedCategory === category.value
                                ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/25'
                                : 'bg-slate-800/50 text-gray-400 border border-white/10 hover:border-white/20 hover:text-white'
                            }`}
                    >
                        <span>{category.icon}</span>
                        <span>{category.label}</span>
                    </button>
                ))}
            </div>

            {/* Sort & Count Row */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                {/* Results Count */}
                <p className="text-sm text-gray-400">
                    Showing <span className="text-white font-semibold">{totalPrizes}</span> prizes
                </p>

                {/* Sort Dropdown */}
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">Sort by:</span>
                    <select
                        value={selectedSort}
                        onChange={(e) => onSortChange(e.target.value as PrizeSortOption)}
                        className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                    >
                        {SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value} className="bg-slate-800">
                                {option.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
}
