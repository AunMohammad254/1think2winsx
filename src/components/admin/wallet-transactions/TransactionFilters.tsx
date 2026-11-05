'use client';

import type { ReactNode } from 'react';
import { Search, RefreshCw, Filter } from 'lucide-react';
import type { FilterStatus, MethodFilter } from './filters';

interface TransactionFiltersProps {
    searchQuery: string;
    onSearchChange: (query: string) => void;
    filterStatus: FilterStatus;
    onFilterStatusChange: (status: FilterStatus) => void;
    filterMethod: MethodFilter;
    onFilterMethodChange: (method: MethodFilter) => void;
    /** Shows "Select All" when the visible transactions include a pending one */
    canSelectAll: boolean;
    onSelectAll: () => void;
    isRefreshing: boolean;
    onRefresh: () => void;
    /** Shown first in the toolbar, before "Select All" (the statement upload) */
    children: ReactNode;
}

/** The search box and the toolbar: extra actions, Select All, the status and method filters, and Refresh */
export default function TransactionFilters({
    searchQuery,
    onSearchChange,
    filterStatus,
    onFilterStatusChange,
    filterMethod,
    onFilterMethodChange,
    canSelectAll,
    onSelectAll,
    isRefreshing,
    onRefresh,
    children,
}: TransactionFiltersProps) {
    return (
        <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                    type="text"
                    placeholder="Search by name, email, or transaction ID..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25"
                />
            </div>

            {/* Filter & Refresh */}
            <div className="flex gap-2 flex-wrap">
                {children}

                {canSelectAll && (
                    <button
                        onClick={onSelectAll}
                        className="px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-all text-sm font-medium hidden sm:block"
                        title="Select all pending on this page"
                    >
                        Select All
                    </button>
                )}
                <div className="relative">
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <select
                        value={filterStatus}
                        onChange={(e) => onFilterStatusChange(e.target.value as FilterStatus)}
                        className="appearance-none pl-9 pr-8 py-3 rounded-xl bg-gray-800 border border-white/10 text-white focus:outline-none focus:border-blue-500/50 cursor-pointer"
                        style={{ colorScheme: 'dark' }}
                    >
                        <option value="pending" className="bg-gray-800 text-white">Pending</option>
                        <option value="approved" className="bg-gray-800 text-white">Approved</option>
                        <option value="rejected" className="bg-gray-800 text-white">Rejected</option>
                        <option value="all" className="bg-gray-800 text-white">All</option>
                    </select>
                </div>
                <div className="relative">
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <select
                        value={filterMethod}
                        onChange={(e) => onFilterMethodChange(e.target.value as MethodFilter)}
                        className="appearance-none pl-9 pr-8 py-3 rounded-xl bg-gray-800 border border-white/10 text-white focus:outline-none focus:border-blue-500/50 cursor-pointer"
                        style={{ colorScheme: 'dark' }}
                    >
                        <option value="all" className="bg-gray-800 text-white">All Methods</option>
                        <option value="Easypaisa" className="bg-gray-800 text-white">Easypaisa</option>
                        <option value="Jazzcash" className="bg-gray-800 text-white">Jazzcash</option>
                        <option value="Bank" className="bg-gray-800 text-white">Bank</option>
                    </select>
                </div>
                <button
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
                    title="Refresh"
                >
                    <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
            </div>
        </div>
    );
}
