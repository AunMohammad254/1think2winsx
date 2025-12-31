'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
    Plus,
    Search,
    Filter,
    MoreVertical,
    Edit,
    Trash2,
    Play,
    Pause,
    Eye,
    Users,
    HelpCircle,
    Clock,
    ChevronLeft,
    ChevronRight,
    ArrowUpDown,
    RefreshCw,
    Download,
} from 'lucide-react';
import QuizFormBuilder from '@/components/admin/QuizFormBuilder';
import { publishQuiz, pauseQuiz, deleteQuiz } from '@/actions/quiz-actions';

// ============================================
// Types
// ============================================
interface Quiz {
    id: string;
    title: string;
    description: string | null;
    duration: number;
    passingScore: number;
    status: 'draft' | 'active' | 'paused';
    createdAt: string;
    updatedAt: string;
    _count?: {
        questions: number;
        attempts: number;
    };
    stats?: {
        totalQuestions: number;
        totalAttempts: number;
        averageScore: number;
    };
}

interface AdminQuizzesResponse {
    quizzes: Quiz[];
    pagination?: {
        total: number;
        page: number;
        limit: number;
    };
}

type SortField = 'title' | 'status' | 'createdAt' | 'questions' | 'attempts';
type SortOrder = 'asc' | 'desc';
type StatusFilter = 'all' | 'draft' | 'active' | 'paused';

// ============================================
// Constants
// ============================================
const statusConfig = {
    draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
    active: { label: 'Published', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    paused: { label: 'Paused', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
};

// ============================================
// Component
// ============================================
export default function AdminQuizManagementPage() {
    const router = useRouter();

    // Data state
    const [quizzes, setQuizzes] = useState<Quiz[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // UI state
    const [showForm, setShowForm] = useState(false);
    const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
    const [selectedQuizzes, setSelectedQuizzes] = useState<string[]>([]);
    const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

    // Filter/Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [sortField, setSortField] = useState<SortField>('createdAt');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 10;

    // ============================================
    // Data Fetching
    // ============================================
    const fetchQuizzes = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/admin/quizzes');

            if (!response.ok) {
                if (response.status === 403) {
                    setError('Access denied. Admin privileges required.');
                    return;
                }
                throw new Error('Failed to fetch quizzes');
            }

            const data: AdminQuizzesResponse = await response.json();
            setQuizzes(data.quizzes || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load quizzes');
            toast.error('Failed to load quizzes');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchQuizzes();
    }, [fetchQuizzes]);

    // ============================================
    // Actions
    // ============================================
    const handlePublish = async (id: string) => {
        const result = await publishQuiz(id);
        if (result.success) {
            toast.success(result.message);
            fetchQuizzes();
        } else {
            toast.error(result.error);
        }
        setActionMenuOpen(null);
    };

    const handlePause = async (id: string) => {
        const result = await pauseQuiz(id);
        if (result.success) {
            toast.success(result.message);
            fetchQuizzes();
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
            fetchQuizzes();
        } else {
            toast.error(result.error);
        }
        setActionMenuOpen(null);
    };

    const handleBulkDelete = async () => {
        if (selectedQuizzes.length === 0) return;

        if (!confirm(`Delete ${selectedQuizzes.length} selected quiz(es)?`)) {
            return;
        }

        let successCount = 0;
        for (const id of selectedQuizzes) {
            const result = await deleteQuiz(id);
            if (result.success) successCount++;
        }

        toast.success(`Deleted ${successCount} quiz(es)`);
        setSelectedQuizzes([]);
        fetchQuizzes();
    };

    const handleEdit = async (quiz: Quiz) => {
        try {
            setLoading(true);
            const response = await fetch(`/api/admin/quizzes/${quiz.id}`);

            if (!response.ok) throw new Error('Failed to load quiz details');

            const data = await response.json();
            const fullQuiz = data.quiz || data;

            // Transform for QuizFormBuilder
            const formData = {
                id: fullQuiz.id,
                title: fullQuiz.title || '',
                description: fullQuiz.description || '',
                duration: fullQuiz.duration || 30,
                passingScore: fullQuiz.passingScore || 70,
                difficulty: 'medium' as const,
                status: (fullQuiz.status || 'draft') as 'draft' | 'active' | 'paused',
                questions: (fullQuiz.questions || []).map((q: { id: string; text: string; options: string | string[]; correctOption?: number; hasCorrectAnswer?: boolean; status?: string }) => ({
                    id: q.id,
                    text: q.text,
                    options: (Array.isArray(q.options) ? q.options : JSON.parse(q.options || '[]')).map((text: string, idx: number) => ({
                        text,
                        isCorrect: q.correctOption === idx,
                    })),
                    correctOption: q.correctOption,
                    status: q.status || 'active',
                })),
            };

            setEditingQuiz(formData as unknown as Quiz);
            setShowForm(true);
        } catch (err) {
            toast.error('Failed to load quiz details');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleFormSuccess = () => {
        setShowForm(false);
        setEditingQuiz(null);
        fetchQuizzes();
    };

    // ============================================
    // Filtering & Sorting
    // ============================================
    const filteredQuizzes = quizzes
        .filter(quiz => {
            // Search filter
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                if (!quiz.title.toLowerCase().includes(query) &&
                    !quiz.description?.toLowerCase().includes(query)) {
                    return false;
                }
            }

            // Status filter
            if (statusFilter !== 'all' && quiz.status !== statusFilter) {
                return false;
            }

            return true;
        })
        .sort((a, b) => {
            let comparison = 0;

            switch (sortField) {
                case 'title':
                    comparison = a.title.localeCompare(b.title);
                    break;
                case 'status':
                    comparison = a.status.localeCompare(b.status);
                    break;
                case 'createdAt':
                    comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                    break;
                case 'questions':
                    comparison = (a._count?.questions || 0) - (b._count?.questions || 0);
                    break;
                case 'attempts':
                    comparison = (a._count?.attempts || 0) - (b._count?.attempts || 0);
                    break;
            }

            return sortOrder === 'asc' ? comparison : -comparison;
        });

    // Pagination
    const totalPages = Math.ceil(filteredQuizzes.length / pageSize);
    const paginatedQuizzes = filteredQuizzes.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    );

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('desc');
        }
    };

    const toggleSelectAll = () => {
        if (selectedQuizzes.length === paginatedQuizzes.length) {
            setSelectedQuizzes([]);
        } else {
            setSelectedQuizzes(paginatedQuizzes.map(q => q.id));
        }
    };

    // ============================================
    // Render Form Mode
    // ============================================
    if (showForm) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-8 px-4">
                <div className="max-w-5xl mx-auto">
                    {/* Header */}
                    <div className="mb-8">
                        <button
                            onClick={() => { setShowForm(false); setEditingQuiz(null); }}
                            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
                        >
                            <ChevronLeft className="w-5 h-5" />
                            Back to Quizzes
                        </button>
                        <h1 className="text-3xl font-bold text-white">
                            {editingQuiz ? 'Edit Quiz' : 'Create New Quiz'}
                        </h1>
                    </div>

                    <QuizFormBuilder
                        initialData={editingQuiz as unknown as undefined}
                        onSuccess={handleFormSuccess}
                        onCancel={() => { setShowForm(false); setEditingQuiz(null); }}
                    />
                </div>
            </div>
        );
    }

    // ============================================
    // Render List Mode
    // ============================================
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <Link
                                href="/admin/dashboard"
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </Link>
                            <h1 className="text-3xl font-bold text-white">Quiz Management</h1>
                        </div>
                        <p className="text-gray-400">Create, edit, and manage your quizzes</p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={fetchQuizzes}
                            disabled={loading}
                            className="p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            onClick={() => setShowForm(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium hover:from-purple-500 hover:to-blue-500 transition-all"
                        >
                            <Plus className="w-5 h-5" />
                            Create Quiz
                        </button>
                    </div>
                </div>

                {/* Filters & Search */}
                <div className="flex flex-col lg:flex-row gap-4 mb-6">
                    {/* Search */}
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                        <input
                            type="text"
                            placeholder="Search quizzes..."
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                            className="w-full pl-10 pr-4 py-2.5 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors"
                        />
                    </div>

                    {/* Status Filter */}
                    <div className="flex items-center gap-2">
                        <Filter className="w-5 h-5 text-gray-500" />
                        {(['all', 'draft', 'active', 'paused'] as StatusFilter[]).map((status) => (
                            <button
                                key={status}
                                onClick={() => { setStatusFilter(status); setCurrentPage(1); }}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === status
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                    }`}
                            >
                                {status === 'all' ? 'All' : statusConfig[status]?.label || status}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Bulk Actions */}
                {selectedQuizzes.length > 0 && (
                    <div className="flex items-center gap-4 mb-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                        <span className="text-purple-300 text-sm">
                            {selectedQuizzes.length} selected
                        </span>
                        <button
                            onClick={handleBulkDelete}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors text-sm"
                        >
                            <Trash2 className="w-4 h-4" />
                            Delete Selected
                        </button>
                        <button
                            onClick={() => setSelectedQuizzes([])}
                            className="text-gray-400 hover:text-white transition-colors text-sm"
                        >
                            Clear Selection
                        </button>
                    </div>
                )}

                {/* Error State */}
                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300">
                        {error}
                    </div>
                )}

                {/* Data Table */}
                <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
                    {/* Table Header */}
                    <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/10 bg-white/5 text-sm font-medium text-gray-400">
                        <div className="col-span-1 flex items-center">
                            <input
                                type="checkbox"
                                checked={selectedQuizzes.length === paginatedQuizzes.length && paginatedQuizzes.length > 0}
                                onChange={toggleSelectAll}
                                className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-purple-500"
                            />
                        </div>
                        <button
                            onClick={() => toggleSort('title')}
                            className="col-span-4 flex items-center gap-2 hover:text-white transition-colors text-left"
                        >
                            Title
                            <ArrowUpDown className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => toggleSort('status')}
                            className="col-span-2 flex items-center gap-2 hover:text-white transition-colors"
                        >
                            Status
                            <ArrowUpDown className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => toggleSort('questions')}
                            className="col-span-1 flex items-center gap-2 hover:text-white transition-colors"
                        >
                            <HelpCircle className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => toggleSort('attempts')}
                            className="col-span-1 flex items-center gap-2 hover:text-white transition-colors"
                        >
                            <Users className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => toggleSort('createdAt')}
                            className="col-span-2 flex items-center gap-2 hover:text-white transition-colors"
                        >
                            Created
                            <ArrowUpDown className="w-4 h-4" />
                        </button>
                        <div className="col-span-1 text-right">Actions</div>
                    </div>

                    {/* Table Body */}
                    {loading ? (
                        <div className="p-8 text-center">
                            <RefreshCw className="w-8 h-8 text-gray-500 animate-spin mx-auto mb-4" />
                            <p className="text-gray-400">Loading quizzes...</p>
                        </div>
                    ) : paginatedQuizzes.length === 0 ? (
                        <div className="p-12 text-center">
                            <HelpCircle className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-white mb-2">No quizzes found</h3>
                            <p className="text-gray-400 mb-4">
                                {searchQuery || statusFilter !== 'all'
                                    ? 'Try adjusting your filters'
                                    : 'Get started by creating your first quiz'}
                            </p>
                            {!searchQuery && statusFilter === 'all' && (
                                <button
                                    onClick={() => setShowForm(true)}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-500 transition-colors"
                                >
                                    <Plus className="w-5 h-5" />
                                    Create Quiz
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y divide-white/5">
                            {paginatedQuizzes.map((quiz) => {
                                const status = statusConfig[quiz.status] || statusConfig.draft;
                                const questionCount = quiz._count?.questions || quiz.stats?.totalQuestions || 0;
                                const attemptCount = quiz._count?.attempts || quiz.stats?.totalAttempts || 0;

                                return (
                                    <div
                                        key={quiz.id}
                                        className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-white/5 transition-colors"
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
                                                        setSelectedQuizzes(selectedQuizzes.filter(id => id !== quiz.id));
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
                                        <div className="col-span-2">
                                            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${status.color}`}>
                                                {status.label}
                                            </span>
                                        </div>

                                        {/* Questions */}
                                        <div className="col-span-1 text-gray-400 text-sm">
                                            {questionCount}
                                        </div>

                                        {/* Attempts */}
                                        <div className="col-span-1 text-gray-400 text-sm">
                                            {attemptCount}
                                        </div>

                                        {/* Created */}
                                        <div className="col-span-2 text-gray-400 text-sm">
                                            {new Date(quiz.createdAt).toLocaleDateString()}
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
                                                        className="fixed inset-0 z-50"
                                                        onClick={() => setActionMenuOpen(null)}
                                                    />
                                                    <div className="absolute right-0 top-10 z-[60] w-48 bg-gray-900 border border-white/10 rounded-xl shadow-xl py-1">
                                                        <button
                                                            onClick={() => handleEdit(quiz)}
                                                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
                                                        >
                                                            <Edit className="w-4 h-4" />
                                                            Edit Quiz
                                                        </button>
                                                        <Link
                                                            href={`/quiz/${quiz.id}`}
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
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between p-4 border-t border-white/10">
                            <p className="text-sm text-gray-400">
                                Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredQuizzes.length)} of {filteredQuizzes.length}
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronLeft className="w-5 h-5" />
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
                                            onClick={() => setCurrentPage(page)}
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
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                    {[
                        { label: 'Total Quizzes', value: quizzes.length, icon: HelpCircle, color: 'text-purple-400' },
                        { label: 'Published', value: quizzes.filter(q => q.status === 'active').length, icon: Play, color: 'text-green-400' },
                        { label: 'Drafts', value: quizzes.filter(q => q.status === 'draft').length, icon: Clock, color: 'text-gray-400' },
                        { label: 'Paused', value: quizzes.filter(q => q.status === 'paused').length, icon: Pause, color: 'text-yellow-400' },
                    ].map((stat) => (
                        <div
                            key={stat.label}
                            className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-xl border border-white/10 p-4"
                        >
                            <div className="flex items-center gap-3">
                                <stat.icon className={`w-8 h-8 ${stat.color}`} />
                                <div>
                                    <p className="text-2xl font-bold text-white">{stat.value}</p>
                                    <p className="text-sm text-gray-400">{stat.label}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
