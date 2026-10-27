'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
    Zap,
    Eye,
    Users,
    HelpCircle,
    Clock,
    ChevronLeft,
    ChevronRight,
    ArrowUpDown,
    RefreshCw,
    Loader2,
} from 'lucide-react';
import {
    DynamicQuizFormBuilder,
    DynamicQuickQuizPanel,
    preloadQuizFormBuilder,
    preloadQuickQuizPanel,
} from '@/components/admin/DynamicAdminComponents';
import { publishQuiz, pauseQuiz, deleteQuiz, pushQuizLive, notifyUpcomingQuiz, goLiveNow, scheduleQuiz } from '@/actions/quiz-actions';
import DateTimePicker from '@/components/ui/DateTimePicker';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_MAX_ENTRIES } from '@/lib/quiz-entries';

// ============================================
// Types
// ============================================
interface Quiz {
    id: string;
    title: string;
    description: string | null;
    duration: number;
    timeUpDuration?: number;
    passingScore: number;
    status: 'draft' | 'active' | 'paused' | 'scheduled' | 'upcoming';
    startsAt?: string | null;
    pushedAt?: string | null;
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
type StatusFilter = 'all' | 'draft' | 'active' | 'paused' | 'scheduled';

// ============================================
// Constants
// ============================================
const statusConfig = {
    draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
    active: { label: 'Published', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    paused: { label: 'Paused', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    scheduled: { label: 'Scheduled', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    upcoming: { label: 'Upcoming', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
};

// The list reports counts as _count or as stats depending on the quiz; the table and the sort use both
const questionCountOf = (quiz: Quiz) => quiz._count?.questions || quiz.stats?.totalQuestions || 0;
const attemptCountOf = (quiz: Quiz) => quiz._count?.attempts || quiz.stats?.totalAttempts || 0;

// Every quiz with its counts in one light read (GET /api/admin/quizzes?view=summary)
const LIST_URL = '/api/admin/quizzes?view=summary';

// The Quiz columns a realtime UPDATE carries that the list shows; counts stay until the refetch
const LIVE_FIELDS = ['title', 'description', 'duration', 'status', 'startsAt', 'pushedAt', 'updatedAt'] as const;

/** An instant as the date picker's local "YYYY-MM-DDTHH:mm", or '' when it has passed or is missing. */
function pickerValue(iso: string | null | undefined): string {
    if (!iso || new Date(iso).getTime() <= Date.now()) return '';
    const date = new Date(iso);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const shortTime = (iso: string) =>
    new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

// ============================================
// Component
// ============================================
export default function AdminQuizManagementPage() {

    // Data state
    const [quizzes, setQuizzes] = useState<Quiz[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // UI state
    const [showForm, setShowForm] = useState(false);
    const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
    const [selectedQuizzes, setSelectedQuizzes] = useState<string[]>([]);
    const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);
    // The quiz an action is running for (one at a time): its buttons wait, so a double click can't broadcast twice
    const [busyId, setBusyId] = useState<string | null>(null);
    const busyRef = useRef<string | null>(null);
    // The quiz whose schedule picker is open, and the time picked (the picker's local time)
    const [scheduling, setScheduling] = useState<{ id: string; startsAt: string } | null>(null);
    // The Quick quiz panel: mounted on first open, then kept, so what was typed survives closing it
    const [quickOpen, setQuickOpen] = useState(false);
    const [quickMounted, setQuickMounted] = useState(false);

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
    const realtimeDebounceRef = useRef<NodeJS.Timeout | null>(null);

    const fetchQuizzes = useCallback(async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const response = await fetch(LIST_URL);

            if (!response.ok) {
                if (response.status === 403) {
                    setError('Access denied. Admin privileges required.');
                    return;
                }
                throw new Error('Failed to fetch quizzes');
            }

            const data: AdminQuizzesResponse = await response.json();
            setQuizzes(data.quizzes || []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load quizzes');
            toast.error('Failed to load quizzes');
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    // Debounced silent re-fetch for realtime events
    const debouncedSilentFetch = useCallback(() => {
        if (realtimeDebounceRef.current) {
            clearTimeout(realtimeDebounceRef.current);
        }
        realtimeDebounceRef.current = setTimeout(() => {
            fetchQuizzes(true);
        }, 500);
    }, [fetchQuizzes]);

    useEffect(() => {
        fetchQuizzes();
    }, [fetchQuizzes]);

    // Show a change at once, before the refetch or the realtime event confirms it
    const patchQuiz = useCallback((id: string, patch: Partial<Quiz>) => {
        setQuizzes(prev => prev.map(q => (q.id === id ? { ...q, ...patch } : q)));
    }, []);

    // ============================================
    // Realtime Subscription
    // ============================================
    useEffect(() => {
        const supabase = createClient();

        const channel = supabase
            .channel('quiz-changes')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'Quiz' },
                (payload) => {
                    toast.success(`New quiz "${(payload.new as { title?: string }).title}" added`);
                    debouncedSilentFetch();
                }
            )
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'Quiz' },
                (payload) => {
                    // Another admin's change shows now; the refetch brings the counts
                    const row = payload.new as Partial<Quiz> | undefined;
                    if (row?.id) {
                        const patch: Partial<Quiz> = {};
                        for (const key of LIVE_FIELDS) if (key in row) Object.assign(patch, { [key]: row[key] });
                        patchQuiz(row.id, patch);
                    }
                    debouncedSilentFetch();
                }
            )
            .on('postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'Quiz' },
                (payload) => {
                    const deletedId = payload.old.id as string;
                    setQuizzes(prev => prev.filter(q => q.id !== deletedId));
                    toast.info('A quiz was deleted');
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            if (realtimeDebounceRef.current) {
                clearTimeout(realtimeDebounceRef.current);
            }
        };
    }, [debouncedSilentFetch, patchQuiz]);

    // ============================================
    // Actions
    // ============================================

    /**
     * Take the page's one-action-at-a-time lock for a quiz: a ref, not the state, since two clicks in one
     * render would both see the state still empty. Another click on the same quiz is a double click and is
     * dropped; a click on another quiz is told why nothing happens.
     */
    const claimQuiz = (id: string) => {
        if (busyRef.current) {
            if (busyRef.current !== id) toast.info('Another quiz action is still running. Try again when it finishes.');
            return false;
        }
        busyRef.current = id;
        setBusyId(id);
        return true;
    };

    const releaseQuiz = () => {
        busyRef.current = null;
        setBusyId(null);
    };

    /**
     * Run one quiz's action with its buttons waiting, toast the outcome, and show a success at once
     * (`onSuccess`) rather than after the realtime event or a refetch. `ask` is a confirmation, asked only
     * once the action can run; declining it leaves the menu open.
     */
    const runQuizAction = async <T,>(
        id: string,
        action: () => Promise<{ success: true; data?: T; message?: string } | { success: false; error: string }>,
        onSuccess?: (data: T | undefined) => void,
        ask?: string,
    ) => {
        if (!claimQuiz(id)) {
            setActionMenuOpen(null);
            return;
        }
        try {
            if (ask && !window.confirm(ask)) return;
            setActionMenuOpen(null);
            const result = await action();
            if (result.success) {
                toast.success(result.message);
                onSuccess?.(result.data);
            } else {
                toast.error(result.error);
            }
        } catch {
            toast.error('Something went wrong. Check your connection and try again.');
        } finally {
            releaseQuiz();
        }
    };

    const handlePublish = (id: string) => runQuizAction(id, () => publishQuiz(id), () => patchQuiz(id, { status: 'active' }));

    // Pushing again restarts the answering window, so a quiz that was pushed already asks first, from the
    // row's button or the menu, and whatever its status now: a paused quiz that ran is asked about too
    const repushQuestion = (quiz: Quiz) => (quiz.pushedAt
        ? `"${quiz.title}" was pushed ${shortTime(quiz.pushedAt)}. Push it again? Its answering time starts over.`
        : undefined);

    // On /quizzes the new pushedAt triggers the live toast/popup for anyone watching the stream
    const handlePush = (quiz: Quiz) =>
        runQuizAction(quiz.id, () => pushQuizLive(quiz.id), (data) => patchQuiz(quiz.id, { pushedAt: data?.pushedAt }), repushQuestion(quiz));

    // One click: published if it isn't yet, and pushed to live viewers
    const handleGoLive = (quiz: Quiz) =>
        runQuizAction(quiz.id, () => goLiveNow(quiz.id), (data) => patchQuiz(quiz.id, { status: 'active', pushedAt: data?.pushedAt }),
            repushQuestion(quiz));

    const openSchedule = (quiz: Quiz) => {
        setActionMenuOpen(null);
        setScheduling({ id: quiz.id, startsAt: pickerValue(quiz.startsAt) });
    };

    // The picker gives the admin's local time; the action needs the absolute instant (lib/schedule-time)
    const handleSchedule = (id: string, startsAt: string) =>
        runQuizAction(id, () => scheduleQuiz(id, new Date(startsAt).toISOString()), (data) => {
            patchQuiz(id, { status: 'scheduled', startsAt: data?.startsAt });
            setScheduling(null);
        });

    // Sends the "upcoming quiz" notification only; the quiz itself stays scheduled.
    const handleNotifyUpcoming = async (id: string) => {
        setActionMenuOpen(null);
        let result = await notifyUpcomingQuiz(id);
        if (!result.success && result.code === 'ALREADY_NOTIFIED') {
            if (!window.confirm('Users were already notified about this quiz. Send the notification again?')) return;
            result = await notifyUpcomingQuiz(id, true);
        }
        if (result.success) {
            toast.success(result.message);
        } else {
            toast.error(result.error);
        }
    };

    const handlePause = (id: string) => runQuizAction(id, () => pauseQuiz(id), () => patchQuiz(id, { status: 'paused' }));

    const handleDelete = (id: string) =>
        runQuizAction(id, () => deleteQuiz(id), () => setQuizzes(prev => prev.filter(q => q.id !== id)),
            'Are you sure you want to delete this quiz? This action cannot be undone.');

    // Only offered while at least one quiz is selected
    const handleBulkDelete = async () => {
        if (!confirm(`Delete ${selectedQuizzes.length} selected quiz(es)?`)) {
            return;
        }

        let successCount = 0;
        for (const id of selectedQuizzes) {
            const result = await deleteQuiz(id);
            if (result.success) successCount++;
        }

        const failedCount = selectedQuizzes.length - successCount;
        if (successCount > 0) toast.success(`Deleted ${successCount} quiz(es)`);
        if (failedCount > 0) toast.error(`Failed to delete ${failedCount} quiz(es)`);
        setSelectedQuizzes([]);
        // Realtime DELETE events will remove from state
    };

    // While a quiz's details load, its row shows a spinner and the list stays on screen
    const handleEdit = async (quiz: Quiz) => {
        setActionMenuOpen(null);
        if (!claimQuiz(quiz.id)) return;
        try {
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
                timeUpDuration: fullQuiz.timeUpDuration ?? 60,
                passingScore: fullQuiz.passingScore || 70,
                accessPrice: fullQuiz.accessPrice ?? 0,
                difficulty: 'medium' as const,
                status: (fullQuiz.status || 'draft') as 'draft' | 'active' | 'paused' | 'scheduled',
                startsAt: fullQuiz.startsAt || null,
                prizeId: fullQuiz.prizeId || null,
                isBumperPrize: fullQuiz.isBumperPrize || false,
                quizType: fullQuiz.quizType || 'normal',
                maxEntries: fullQuiz.maxEntries ?? DEFAULT_MAX_ENTRIES,
                pointsPool: fullQuiz.pointsPool ?? 0,
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
            releaseQuiz();
        }
    };

    const handleReuse = async (quiz: Quiz) => {
        setActionMenuOpen(null);
        if (!claimQuiz(quiz.id)) return;
        // Outside the try so a failure can replace the loading toast instead of leaving it spinning
        const toastId = toast.loading('Loading quiz details to copy...');
        try {
            const response = await fetch(`/api/admin/quizzes/${quiz.id}`);

            if (!response.ok) throw new Error('Failed to load quiz details');

            const data = await response.json();
            const fullQuiz = data.quiz || data;

            toast.loading('Creating duplicated quiz...', { id: toastId });

            const input = {
                title: `${fullQuiz.title} (Copy)`,
                description: fullQuiz.description || '',
                duration: fullQuiz.duration || 30,
                timeUpDuration: fullQuiz.timeUpDuration ?? 60,
                passingScore: fullQuiz.passingScore || 70,
                accessPrice: fullQuiz.accessPrice || 0,
                difficulty: 'medium' as const,
                status: 'draft' as const,
                startsAt: null,
                prizeId: fullQuiz.prizeId || null,
                isBumperPrize: fullQuiz.isBumperPrize || false,
                quizType: fullQuiz.quizType || 'normal',
                maxEntries: fullQuiz.maxEntries ?? DEFAULT_MAX_ENTRIES,
                pointsPool: fullQuiz.pointsPool ?? 0,
                questions: (fullQuiz.questions || []).map((q: any) => ({
                    text: q.text,
                    options: (Array.isArray(q.options) ? q.options : JSON.parse(q.options || '[]')).map((text: string, idx: number) => ({
                        text,
                        isCorrect: q.correctOption === idx,
                    })),
                    correctOption: q.correctOption ?? 0,
                    status: q.status || 'active',
                })),
            };

            const { createQuiz } = await import('@/actions/quiz-actions');
            const result = await createQuiz(input);

            if (result.success) {
                toast.success('Quiz duplicated and saved to draft!', { id: toastId });
                // The copy has its own counts, so the list is read again rather than patched
                fetchQuizzes(true);
            } else {
                toast.error(result.error || 'Failed to duplicate quiz', { id: toastId });
            }
        } catch (err) {
            toast.error('An unexpected error occurred while duplicating', { id: toastId });
            console.error(err);
        } finally {
            releaseQuiz();
        }
    };

    const handleFormSuccess = () => {
        setShowForm(false);
        setEditingQuiz(null);
        // Silent: the list stays on screen while it refreshes
        fetchQuizzes(true);
    };

    const openQuickQuiz = () => {
        setQuickMounted(true);
        setQuickOpen(true);
    };

    // ============================================
    // Filtering & Sorting
    // ============================================
    // Memoised: a menu toggle or a busy spinner re-renders the page, and the list can be 500 quizzes
    const filteredQuizzes = useMemo(() => quizzes
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
            // "Scheduled" also covers upcoming quizzes: they are scheduled ones users were already told about
            const matchesStatus = statusFilter === 'scheduled'
                ? quiz.status === 'scheduled' || quiz.status === 'upcoming'
                : quiz.status === statusFilter;
            if (statusFilter !== 'all' && !matchesStatus) {
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
                    comparison = questionCountOf(a) - questionCountOf(b);
                    break;
                case 'attempts':
                    comparison = attemptCountOf(a) - attemptCountOf(b);
                    break;
            }

            return sortOrder === 'asc' ? comparison : -comparison;
        }), [quizzes, searchQuery, statusFilter, sortField, sortOrder]);

    const stats = useMemo(() => [
        { label: 'Total Quizzes', value: quizzes.length, icon: HelpCircle, color: 'text-purple-400' },
        { label: 'Published', value: quizzes.filter(q => q.status === 'active').length, icon: Play, color: 'text-green-400' },
        { label: 'Scheduled', value: quizzes.filter(q => q.status === 'scheduled' || q.status === 'upcoming').length, icon: Clock, color: 'text-blue-400' },
        { label: 'Drafts/Paused', value: quizzes.filter(q => q.status === 'draft' || q.status === 'paused').length, icon: Pause, color: 'text-yellow-400' },
    ], [quizzes]);

    // Pagination
    const totalPages = Math.ceil(filteredQuizzes.length / pageSize);
    // Realtime deletes can empty the open page; step back to the last page that still has quizzes
    const lastPage = Math.max(totalPages, 1);
    if (currentPage > lastPage) setCurrentPage(lastPage);
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

    // Compares ids, not counts: a full selection on another page is not this page selected
    const allOnPageSelected = paginatedQuizzes.length > 0 && paginatedQuizzes.every(q => selectedQuizzes.includes(q.id));

    const toggleSelectAll = () => {
        if (allOnPageSelected) {
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

                    <DynamicQuizFormBuilder
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

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={() => fetchQuizzes()}
                            disabled={loading}
                            aria-label="Refresh quizzes"
                            title="Refresh quizzes"
                            className="p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            onClick={openQuickQuiz}
                            onMouseEnter={preloadQuickQuizPanel}
                            onFocus={preloadQuickQuizPanel}
                            title="Write a quiz and go live, schedule it or save a draft in one step"
                            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-pink-500/40 bg-pink-500/10 text-pink-200 font-medium hover:bg-pink-500/20 transition-colors"
                        >
                            <Zap className="w-5 h-5" />
                            Quick Quiz
                        </button>
                        <button
                            onClick={() => setShowForm(true)}
                            onMouseEnter={preloadQuizFormBuilder}
                            onFocus={preloadQuizFormBuilder}
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
                    <div className="flex flex-wrap items-center gap-2">
                        <Filter className="w-5 h-5 text-gray-500 shrink-0" />
                        {(['all', 'draft', 'active', 'paused', 'scheduled'] as StatusFilter[]).map((status) => (
                            <button
                                key={status}
                                onClick={() => { setStatusFilter(status); setCurrentPage(1); }}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === status
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                    }`}
                            >
                                {status === 'all' ? 'All' : statusConfig[status].label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Bulk Actions */}
                {selectedQuizzes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
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
                <div className="relative z-10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10">
                    {/* Table Header */}
                    <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/10 bg-white/5 text-sm font-medium text-gray-400">
                        <div className="col-span-1 flex items-center">
                            <input
                                type="checkbox"
                                checked={allOnPageSelected}
                                onChange={toggleSelectAll}
                                className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-purple-500"
                            />
                        </div>
                        <button
                            onClick={() => toggleSort('title')}
                            className="col-span-6 md:col-span-3 flex items-center gap-2 hover:text-white transition-colors text-left"
                        >
                            Title
                            <ArrowUpDown className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => toggleSort('status')}
                            className="col-span-3 md:col-span-2 flex items-center gap-2 hover:text-white transition-colors"
                        >
                            Status
                            <ArrowUpDown className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => toggleSort('questions')}
                            className="hidden md:flex col-span-1 items-center gap-2 hover:text-white transition-colors"
                        >
                            <HelpCircle className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => toggleSort('attempts')}
                            className="hidden md:flex col-span-1 items-center gap-2 hover:text-white transition-colors"
                        >
                            <Users className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => toggleSort('createdAt')}
                            className="hidden md:flex col-span-2 items-center gap-2 hover:text-white transition-colors"
                        >
                            Created
                            <ArrowUpDown className="w-4 h-4" />
                        </button>
                        <div className="col-span-2 text-right">Actions</div>
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
                                const questionCount = questionCountOf(quiz);
                                const attemptCount = attemptCountOf(quiz);
                                const busy = busyId === quiz.id;

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
                                        <div className="col-span-6 md:col-span-3 min-w-0">
                                            <h3 className="font-medium text-white truncate">{quiz.title}</h3>
                                            {quiz.description && (
                                                <p className="text-sm text-gray-500 truncate">{quiz.description}</p>
                                            )}
                                        </div>

                                        {/* Status */}
                                        <div className="col-span-3 md:col-span-2">
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${status.color}`}>
                                                {status.label}
                                                {(quiz.status === 'scheduled' || quiz.status === 'upcoming') && quiz.startsAt && (
                                                    <span className="opacity-80 ml-1">
                                                        ({shortTime(quiz.startsAt)})
                                                    </span>
                                                )}
                                            </span>
                                        </div>

                                        {/* Questions */}
                                        <div className="hidden md:block col-span-1 text-gray-400 text-sm">
                                            {questionCount}
                                        </div>

                                        {/* Attempts */}
                                        <div className="hidden md:block col-span-1 text-gray-400 text-sm">
                                            {attemptCount}
                                        </div>

                                        {/* Created */}
                                        <div className="hidden md:block col-span-2 text-gray-400 text-sm">
                                            {new Date(quiz.createdAt).toLocaleDateString()}
                                        </div>

                                        {/* Actions: one click to go live or schedule, the rest in the menu */}
                                        <div className="col-span-2 flex items-center justify-end gap-1 relative">
                                            {busy && <Loader2 aria-label={`Working on ${quiz.title}`} className="w-4 h-4 text-gray-400 animate-spin" />}
                                            <button
                                                onClick={() => handleGoLive(quiz)}
                                                disabled={busy}
                                                aria-label={`${quiz.status === 'active' ? 'Push to live viewers' : 'Go live now'}: ${quiz.title}`}
                                                title={quiz.status === 'active' ? 'Push to live viewers' : 'Go live now: publish and push to live viewers'}
                                                className="hidden md:inline-flex p-2 rounded-lg text-pink-400 hover:text-pink-300 hover:bg-pink-500/10 transition-colors disabled:opacity-40"
                                            >
                                                <Zap className="w-4 h-4" />
                                            </button>
                                            {quiz.status !== 'active' && (
                                                <button
                                                    onClick={() => openSchedule(quiz)}
                                                    disabled={busy}
                                                    aria-label={`Schedule: ${quiz.title}`}
                                                    title="Schedule: goes live on its own at the time you pick"
                                                    className="hidden md:inline-flex p-2 rounded-lg text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors disabled:opacity-40"
                                                >
                                                    <Clock className="w-4 h-4" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => setActionMenuOpen(actionMenuOpen === quiz.id ? null : quiz.id)}
                                                aria-label={`More actions: ${quiz.title}`}
                                                aria-expanded={actionMenuOpen === quiz.id}
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
                                                    <div className="absolute right-0 top-full mt-2 z-[1000] w-48 bg-gray-900 border border-white/10 rounded-xl shadow-xl py-1">
                                                        {quiz.status !== 'active' && (
                                                            <>
                                                                <button
                                                                    onClick={() => handleGoLive(quiz)}
                                                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-pink-400 hover:bg-white/10 transition-colors"
                                                                >
                                                                    <Zap className="w-4 h-4" />
                                                                    Go live now
                                                                </button>
                                                                <button
                                                                    onClick={() => openSchedule(quiz)}
                                                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-blue-400 hover:bg-white/10 transition-colors"
                                                                >
                                                                    <Clock className="w-4 h-4" />
                                                                    Schedule…
                                                                </button>
                                                                <div className="border-t border-white/10 my-1" />
                                                            </>
                                                        )}
                                                        <button
                                                            onClick={() => handleEdit(quiz)}
                                                            onMouseEnter={preloadQuizFormBuilder}
                                                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
                                                        >
                                                            <Edit className="w-4 h-4" />
                                                            Edit Quiz
                                                        </button>
                                                        <button
                                                            onClick={() => handleReuse(quiz)}
                                                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
                                                        >
                                                            <RefreshCw className="w-4 h-4" />
                                                            Reuse Quiz
                                                        </button>
                                                        <Link
                                                            href={`/quizzes?openQuiz=${quiz.id}`}
                                                            prefetch={false}
                                                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
                                                        >
                                                            <Eye className="w-4 h-4" />
                                                            Preview
                                                        </Link>
                                                        {quiz.status !== 'active' ? (
                                                            <>
                                                                <button
                                                                    onClick={() => handlePublish(quiz.id)}
                                                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-green-400 hover:bg-white/10 transition-colors"
                                                                >
                                                                    <Play className="w-4 h-4" />
                                                                    Publish
                                                                </button>
                                                                {(quiz.status === 'scheduled' || quiz.status === 'upcoming') && (
                                                                    <button
                                                                        onClick={() => handleNotifyUpcoming(quiz.id)}
                                                                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-blue-400 hover:bg-white/10 transition-colors"
                                                                    >
                                                                        <Clock className="w-4 h-4" />
                                                                        Notify users: upcoming quiz
                                                                    </button>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    onClick={() => handlePush(quiz)}
                                                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-pink-400 hover:bg-white/10 transition-colors"
                                                                >
                                                                    <Zap className="w-4 h-4" />
                                                                    Push to live viewers
                                                                </button>
                                                                <button
                                                                    onClick={() => handlePause(quiz.id)}
                                                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-yellow-400 hover:bg-white/10 transition-colors"
                                                                >
                                                                    <Pause className="w-4 h-4" />
                                                                    Pause
                                                                </button>
                                                            </>
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

                                        {/* Schedule: the quiz goes live on its own at the time picked */}
                                        {scheduling?.id === quiz.id && (
                                            <div role="group" aria-label={`Schedule ${quiz.title}`}
                                                className="col-span-12 flex flex-wrap items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
                                                <span className="text-sm text-blue-200">Goes live on its own at</span>
                                                <div className="min-w-[16rem] flex-1 sm:flex-none">
                                                    <DateTimePicker
                                                        id={`schedule-${quiz.id}`}
                                                        value={scheduling.startsAt}
                                                        onChange={(startsAt) => setScheduling({ id: quiz.id, startsAt })}
                                                        placeholder="Pick the start time"
                                                    />
                                                </div>
                                                <button
                                                    onClick={() => handleSchedule(quiz.id, scheduling.startsAt)}
                                                    disabled={!scheduling.startsAt || busy}
                                                    className="px-4 py-2 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
                                                >
                                                    {busy ? 'Scheduling…' : 'Schedule'}
                                                </button>
                                                <button
                                                    onClick={() => setScheduling(null)}
                                                    className="px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/10 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        )}
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
                    {stats.map((stat) => (
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

            {quickMounted && (
                <DynamicQuickQuizPanel open={quickOpen} onOpenChange={setQuickOpen} onSaved={() => fetchQuizzes(true)} />
            )}
        </div>
    );
}
