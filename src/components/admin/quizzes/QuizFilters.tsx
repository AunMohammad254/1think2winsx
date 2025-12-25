'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, useEffect } from 'react';
import { Search, Filter, X, Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';

interface QuizFiltersProps {
    defaultSearch?: string;
    defaultStatus?: string;
}

const statusOptions = [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Drafts' },
    { value: 'active', label: 'Published' },
    { value: 'paused', label: 'Paused' },
];

export default function QuizFilters({ defaultSearch = '', defaultStatus = 'all' }: QuizFiltersProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    const [search, setSearch] = useState(defaultSearch);
    const [status, setStatus] = useState(defaultStatus);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (search !== defaultSearch) {
                handleSearch(search);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const createQueryString = (params: Record<string, string>) => {
        const newParams = new URLSearchParams(searchParams.toString());
        Object.entries(params).forEach(([key, value]) => {
            if (value && value !== 'all') {
                newParams.set(key, value);
            } else {
                newParams.delete(key);
            }
        });
        // Reset to page 1 when filters change
        newParams.set('page', '1');
        return newParams.toString();
    };

    const handleSearch = (value: string) => {
        startTransition(() => {
            router.push(`?${createQueryString({ query: value })}`);
        });
    };

    const handleStatusChange = (newStatus: string) => {
        setStatus(newStatus);
        startTransition(() => {
            router.push(`?${createQueryString({ status: newStatus })}`);
        });
    };

    const handleClearFilters = () => {
        setSearch('');
        setStatus('all');
        startTransition(() => {
            router.push('/admin/quizzes');
        });
    };

    const hasActiveFilters = search || status !== 'all';

    return (
        <div className="flex flex-col lg:flex-row gap-4 mb-6">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                    type="text"
                    placeholder="Search quizzes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors"
                />
                {search && (
                    <button
                        onClick={() => {
                            setSearch('');
                            handleSearch('');
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2 flex-wrap">
                <Filter className="w-5 h-5 text-gray-500" />
                {statusOptions.map((option) => (
                    <button
                        key={option.value}
                        onClick={() => handleStatusChange(option.value)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${status === option.value
                                ? 'bg-purple-600 text-white'
                                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                            }`}
                    >
                        {option.label}
                    </button>
                ))}

                {hasActiveFilters && (
                    <button
                        onClick={handleClearFilters}
                        className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1"
                    >
                        <X className="w-4 h-4" />
                        Clear
                    </button>
                )}
            </div>

            {/* Loading indicator */}
            {isPending && (
                <div className="flex items-center text-gray-400">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                </div>
            )}

            {/* Create Button */}
            <div className="flex items-center gap-3 lg:ml-auto">
                <Link
                    href="/admin/quiz"
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium hover:from-purple-500 hover:to-blue-500 transition-all shadow-lg shadow-purple-500/25"
                >
                    <Plus className="w-5 h-5" />
                    Create Quiz
                </Link>
            </div>
        </div>
    );
}
