'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
    MoreVertical,
    Edit,
    Trash2,
    Play,
    Pause,
    Eye,
    HelpCircle,
    Users,
    ArrowUpDown,
} from 'lucide-react';
import StatusToggle from './StatusToggle';
import { deleteQuiz, publishQuiz, pauseQuiz } from '@/actions/quiz-actions';
import type { QuizListItem, PaginatedQuizzes } from '@/actions/dashboard-actions';

// Status badge config
const statusConfig: Record<string, { label: string; color: string }> = {
    draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
    active: { label: 'Published', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    paused: { label: 'Paused', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
};

interface QuizDataTableProps {
    data: PaginatedQuizzes;
    searchParams: {
        query?: string;
        page?: string;
        status?: string;
        sortBy?: string;
        sortOrder?: string;
    };
}

export default function QuizDataTable({ data, searchParams }: QuizDataTableProps) {
    const router = useRouter();
    const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);
    const [selectedQuizzes, setSelectedQuizzes] = useState<string[]>([]);

    const { quizzes, pagination } = data;
    const currentPage = pagination.page;
    const totalPages = pagination.totalPages;

    // URL-based navigation helpers
    const createQueryString = (params: Record<string, string>) => {
        const newParams = new URLSearchParams(searchParams as Record<string, string>);
        Object.entries(params).forEach(([key, value]) => {
            if (value) {
                newParams.set(key, value);
            } else {
                newParams.delete(key);
            }
        });
        return newParams.toString();
    };

    const handleSort = (field: string) => {
        const currentSortBy = searchParams.sortBy || 'createdAt';
        const currentSortOrder = searchParams.sortOrder || 'desc';

        const newOrder = currentSortBy === field && currentSortOrder === 'desc' ? 'asc' : 'desc';
        router.push(`?${createQueryString({ sortBy: field, sortOrder: newOrder, page: '1' })}`);
    };

    const handlePageChange = (page: number) => {
        router.push(`?${createQueryString({ page: page.toString() })}`);
    };

    const handlePublish = async (id: string) => {
        const result = await publishQuiz(id);
        if (result.success) {
            toast.success(result.message);
            router.refresh();
        } else {
            toast.error(result.error);
        }
        setActionMenuOpen(null);
    };

    const handlePause = async (id: string) => {
        const result = await pauseQuiz(id);
        if (result.success) {
            toast.success(result.message);
            router.refresh();
        } else {
            toast.error(result.error);
        }
        setActionMenuOpen(null);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this quiz? This action cannot be undone.')) {
            return;
        }

        const result = await deleteQuiz(id);
        if (result.success) {
            toast.success(result.message);
            router.refresh();
        } else {
            toast.error(result.error);
        }
        setActionMenuOpen(null);
    };

    const toggleSelectAll = () => {
        if (selectedQuizzes.length === quizzes.length) {
            setSelectedQuizzes([]);
        } else {
            setSelectedQuizzes(quizzes.map((q) => q.id));
        }
    };

    // Empty state
    if (quizzes.length === 0) {
        return (
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl">
                <div className="p-12 text-center">
                    <HelpCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-white mb-2">No quizzes found</h3>
                    <p className="text-gray-400 mb-6">
                        {searchParams.query || searchParams.status
                            ? 'Try adjusting your search or filters'
                            : 'Get started by creating your first quiz'}
                    </p>
                    {!searchParams.query && !searchParams.status && (
                        <Link
                            href="/admin/quiz"
                            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium hover:from-purple-500 hover:to-blue-500 transition-all"
                        >
                            Create Quiz
                        </Link>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl">
            {/* Bulk Actions Bar */}
            {selectedQuizzes.length > 0 && (
                <div className="flex items-center gap-4 px-6 py-3 bg-purple-500/10 border-b border-purple-500/20">
                    <span className="text-purple-300 text-sm font-medium">
                        {selectedQuizzes.length} selected
                    </span>
                    <button
                        onClick={async () => {
                            if (!confirm(`Delete ${selectedQuizzes.length} quizzes?`)) return;
                            for (const id of selectedQuizzes) {
                                await deleteQuiz(id);
                            }
                            toast.success(`Deleted ${selectedQuizzes.length} quizzes`);
                            setSelectedQuizzes([]);
                            router.refresh();
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors text-sm"
                    >
                        <Trash2 className="w-4 h-4" />
                        Delete
                    </button>
                    <button
                        onClick={() => setSelectedQuizzes([])}
                        className="text-gray-400 hover:text-white transition-colors text-sm"
                    >
                        Clear
                    </button>
                </div>
            )}

            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/10 bg-white/5 text-sm font-medium text-gray-400">
                <div className="col-span-1 flex items-center">
                    <input
                        type="checkbox"
                        checked={selectedQuizzes.length === quizzes.length && quizzes.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-purple-500"
                    />
                </div>
                <button
                    onClick={() => handleSort('title')}
                    className="col-span-4 flex items-center gap-2 hover:text-white transition-colors text-left"
                >
                    Title
                    <ArrowUpDown className="w-4 h-4" />
                </button>
                <button
                    onClick={() => handleSort('status')}
                    className="col-span-2 flex items-center gap-2 hover:text-white transition-colors"
                >
                    Status
                    <ArrowUpDown className="w-4 h-4" />
                </button>
                <div className="col-span-1 flex items-center gap-2">
                    <HelpCircle className="w-4 h-4" />
                </div>
                <div className="col-span-1 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                </div>
                <button
                    onClick={() => handleSort('createdAt')}
                    className="col-span-2 flex items-center gap-2 hover:text-white transition-colors"
                >
                    Created
                    <ArrowUpDown className="w-4 h-4" />
                </button>
                <div className="col-span-1 text-right">Actions</div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-white/5">
                {quizzes.map((quiz) => {
                    const status = statusConfig[quiz.status] || statusConfig.draft;

                    return (
                        <div
                            key={quiz.id}
                            className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-white/5 transition-colors"
                        >
                            {/* Checkbox */}
                            <div className="col-span-1">
                                <input
                                    type="checkbox"
                                    checked={selectedQuizzes.includes(quiz.id)}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedQuizzes([...selectedQuizzes, quiz.id]);
                                        } else {
                                            setSelectedQuizzes(selectedQuizzes.filter((id) => id !== quiz.id));
                                        }
                                    }}
                                    className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-purple-500"
                                />
                            </div>

                            {/* Title */}
                            <div className="col-span-4">
                                <h3 className="font-medium text-white truncate">{quiz.title}</h3>
                                {quiz.description && (
                                    <p className="text-sm text-gray-500 truncate">{quiz.description}</p>
                                )}
                            </div>

                            {/* Status */}
                            <div className="col-span-2 flex items-center gap-2">
                                <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${status.color}`}>
                                    {status.label}
                                </span>
                                <StatusToggle quizId={quiz.id} currentStatus={quiz.status} />
                            </div>

                            {/* Questions */}
                            <div className="col-span-1 text-gray-400 text-sm">
                                {quiz._count.questions}
                            </div>

                            {/* Attempts */}
                            <div className="col-span-1 text-gray-400 text-sm">
                                {quiz._count.attempts}
                            </div>

                            {/* Created */}
                            <div className="col-span-2 text-gray-400 text-sm">
                                {formatDistanceToNow(new Date(quiz.createdAt), { addSuffix: true })}
                            </div>

                            {/* Actions */}
                            <div className="col-span-1 flex justify-end relative">
                                <button
                                    onClick={() => setActionMenuOpen(actionMenuOpen === quiz.id ? null : quiz.id)}
                                    className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                                >
                                    <MoreVertical className="w-5 h-5" />
                                </button>

                                {/* Dropdown Menu */}
                                {actionMenuOpen === quiz.id && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-10"
                                            onClick={() => setActionMenuOpen(null)}
                                        />
                                        <div className="absolute right-0 top-10 z-20 w-48 bg-gray-900 border border-white/10 rounded-xl shadow-xl py-1">
                                            <Link
                                                href={`/admin/quiz?edit=${quiz.id}`}
                                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
                                            >
                                                <Edit className="w-4 h-4" />
                                                Edit Quiz
                                            </Link>
                                            <Link
                                                href={`/quiz/${quiz.id}`}
                                                target="_blank"
                                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
                                            >
                                                <Eye className="w-4 h-4" />
                                                Preview
                                            </Link>
                                            {quiz.status !== 'active' ? (
                                                <button
                                                    onClick={() => handlePublish(quiz.id)}
                                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-green-400 hover:bg-white/10 transition-colors"
                                                >
                                                    <Play className="w-4 h-4" />
                                                    Publish
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handlePause(quiz.id)}
                                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-yellow-400 hover:bg-white/10 transition-colors"
                                                >
                                                    <Pause className="w-4 h-4" />
                                                    Pause
                                                </button>
                                            )}
                                            <div className="border-t border-white/10 my-1" />
                                            <button
                                                onClick={() => handleDelete(quiz.id)}
                                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-white/10 transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                Delete
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
                    <p className="text-sm text-gray-400">
                        Showing {((currentPage - 1) * pagination.pageSize) + 1} to{' '}
                        {Math.min(currentPage * pagination.pageSize, pagination.total)} of{' '}
                        {pagination.total} quizzes
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Previous
                        </button>
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let page: number;
                            if (totalPages <= 5) {
                                page = i + 1;
                            } else if (currentPage <= 3) {
                                page = i + 1;
                            } else if (currentPage >= totalPages - 2) {
                                page = totalPages - 4 + i;
                            } else {
                                page = currentPage - 2 + i;
                            }
                            return (
                                <button
                                    key={page}
                                    onClick={() => handlePageChange(page)}
                                    className={`w-10 h-10 rounded-lg font-medium transition-colors ${currentPage === page
                                        ? 'bg-purple-600 text-white'
                                        : 'text-gray-400 hover:text-white hover:bg-white/10'
                                        }`}
                                >
                                    {page}
                                </button>
                            );
                        })}
                        <button
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            className="px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Skeleton version
export function QuizDataTableSkeleton() {
    return (
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/10 bg-white/5">
                {[1, 4, 2, 1, 1, 2, 1].map((span, i) => (
                    <div key={i} className={`col-span-${span} h-4 bg-gray-700/50 rounded animate-pulse`} />
                ))}
            </div>

            {/* Rows */}
            <div className="divide-y divide-white/5">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="grid grid-cols-12 gap-4 px-6 py-4">
                        <div className="col-span-1">
                            <div className="w-4 h-4 bg-gray-700/50 rounded animate-pulse" />
                        </div>
                        <div className="col-span-4 space-y-2">
                            <div className="h-4 w-3/4 bg-gray-700/50 rounded animate-pulse" />
                            <div className="h-3 w-1/2 bg-gray-700/50 rounded animate-pulse" />
                        </div>
                        <div className="col-span-2">
                            <div className="h-6 w-20 bg-gray-700/50 rounded-full animate-pulse" />
                        </div>
                        <div className="col-span-1">
                            <div className="h-4 w-8 bg-gray-700/50 rounded animate-pulse" />
                        </div>
                        <div className="col-span-1">
                            <div className="h-4 w-8 bg-gray-700/50 rounded animate-pulse" />
                        </div>
                        <div className="col-span-2">
                            <div className="h-4 w-24 bg-gray-700/50 rounded animate-pulse" />
                        </div>
                        <div className="col-span-1 flex justify-end">
                            <div className="w-8 h-8 bg-gray-700/50 rounded animate-pulse" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
