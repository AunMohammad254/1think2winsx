'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { deleteReviewAction, listReviewsAction, moderateReviewAction, type ListReviewsResult } from '@/actions/review-actions';
import type { AdminReview } from '@/lib/supabase/db-modules/review.db';
import { REVIEW_NOTE_MAX, REVIEW_STATUSES, type ReviewStatus } from '@/lib/reviews';
import { StarDisplay } from '@/components/reviews/StarRating';

type Filter = ReviewStatus | 'all';
type Loaded = Extract<ListReviewsResult, { success: true }>;

const FILTER_LABELS: Record<Filter, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', all: 'All' };

const STATUS_STYLES: Record<ReviewStatus, string> = {
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    approved: 'bg-green-500/15 text-green-300 border-green-500/30',
    rejected: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' });

/** One review, with Approve / Reject (and an optional note for the player) / Delete */
function ReviewItem({ review, onChanged }: { review: AdminReview; onChanged: () => void }) {
    const [rejecting, setRejecting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [note, setNote] = useState(review.moderationNote ?? '');
    const [busy, setBusy] = useState(false);

    async function moderate(status: 'approved' | 'rejected') {
        setBusy(true);
        const result = await moderateReviewAction({ id: review.id, status, note: status === 'rejected' ? note : '' }).catch(
            () => ({ success: false, error: 'Failed to update the review' }) as const,
        );
        setBusy(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        const done = status === 'approved' ? 'Review approved: it now shows on the home page.' : 'Review rejected.';
        toast.success(result.notified ? `${done} The player has been notified.` : done);
        setRejecting(false);
        onChanged();
    }

    async function remove() {
        setBusy(true);
        const result = await deleteReviewAction(review.id).catch(() => ({ success: false, error: 'Failed to delete the review' }) as const);
        setBusy(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        toast.success('Review deleted');
        onChanged();
    }

    return (
        <li className="p-4 sm:p-5 rounded-xl bg-white/5 border border-white/10">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <StarDisplay rating={review.rating} />
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[review.status]}`}>
                    {FILTER_LABELS[review.status]}
                </span>
                <span className="ml-auto text-xs text-gray-500">{formatWhen(review.updatedAt)}</span>
            </div>
            <p className="mt-3 text-gray-100 whitespace-pre-wrap break-words">{review.comment}</p>
            <p className="mt-3 text-sm text-white font-medium">
                {review.displayName}
                {review.city && <span className="text-gray-400 font-normal"> · {review.city}</span>}
            </p>
            <p className="text-xs text-gray-500 break-all">
                {review.user ? `Account: ${review.user.name || 'No name'} · ${review.user.email}` : 'Player account deleted'}
            </p>
            {review.moderationNote && !rejecting && (
                <p className="mt-2 text-xs text-gray-400">Note to the player: {review.moderationNote}</p>
            )}
            {review.moderatedBy && review.moderatedAt && (
                <p className="text-xs text-gray-500">Last decision by {review.moderatedBy}, {formatWhen(review.moderatedAt)}</p>
            )}

            {rejecting && (
                <label className="mt-4 block">
                    <span className="text-sm font-medium text-gray-300">Why? (optional, the player sees this)</span>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={REVIEW_NOTE_MAX}
                        rows={3}
                        placeholder="e.g. Please leave out phone numbers and links"
                        className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500"
                    />
                    <span className="block text-right text-xs text-gray-500">{note.length}/{REVIEW_NOTE_MAX}</span>
                </label>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
                {rejecting ? (
                    <>
                        <button
                            type="button"
                            onClick={() => moderate('rejected')}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold disabled:opacity-50"
                        >
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                            Reject review
                        </button>
                        <button type="button" onClick={() => setRejecting(false)} disabled={busy} className="px-4 py-2 rounded-xl text-sm text-gray-300 hover:bg-white/10">
                            Cancel
                        </button>
                    </>
                ) : (
                    <>
                        {review.status !== 'approved' && (
                            <button
                                type="button"
                                onClick={() => moderate('approved')}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-500 text-gray-950 text-sm font-semibold disabled:opacity-50"
                            >
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                Approve
                            </button>
                        )}
                        {review.status !== 'rejected' && (
                            <button
                                type="button"
                                onClick={() => setRejecting(true)}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 text-white text-sm hover:bg-white/20 disabled:opacity-50"
                            >
                                <X className="w-4 h-4" />
                                {review.status === 'approved' ? 'Unpublish' : 'Reject'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}
                            onBlur={() => setConfirmDelete(false)}
                            disabled={busy}
                            className={`ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm disabled:opacity-50 ${
                                confirmDelete ? 'bg-red-500/20 text-red-200 border border-red-500/40' : 'text-gray-400 hover:bg-white/10'
                            }`}
                        >
                            <Trash2 className="w-4 h-4" />
                            {confirmDelete ? 'Click again to delete' : 'Delete'}
                        </button>
                    </>
                )}
            </div>
        </li>
    );
}

export default function ReviewsManager() {
    const [filter, setFilter] = useState<Filter>('pending');
    const [page, setPage] = useState(1);
    const [data, setData] = useState<Loaded | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await listReviewsAction({ status: filter === 'all' ? undefined : filter, page });
            if (result.success) {
                setData(result);
                setError(null);
            } else {
                setError(result.error);
            }
        } catch {
            setError('Failed to load reviews');
        }
        setLoading(false);
    }, [filter, page]);

    useEffect(() => {
        load();
    }, [load]);

    const choose = (next: Filter) => {
        setFilter(next);
        setPage(1);
    };
    const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
                {([...REVIEW_STATUSES, 'all'] as Filter[]).map((f) => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => choose(f)}
                        aria-pressed={filter === f}
                        className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                            filter === f ? 'bg-amber-500/20 border-amber-500/50 text-amber-200' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                        }`}
                    >
                        {FILTER_LABELS[f]}
                        {data && f !== 'all' && <span className="ml-2 text-xs opacity-70">{data.counts[f]}</span>}
                    </button>
                ))}
                <button type="button" onClick={load} aria-label="Refresh" className="ml-auto p-2.5 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10">
                    <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <p className="text-sm text-gray-400">
                Only approved reviews show on the home page. When a player edits a review it comes back here as pending.
            </p>

            {error && (
                <div role="alert" className="flex items-center justify-between gap-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200">
                    <span>{error}</span>
                    <button type="button" onClick={load} className="underline">
                        Try again
                    </button>
                </div>
            )}

            {!data && loading && <p className="text-gray-400">Loading reviews…</p>}

            {data && data.reviews.length === 0 && (
                <p className="p-8 text-center rounded-xl bg-white/5 border border-white/10 text-gray-400">No reviews here.</p>
            )}

            {data && data.reviews.length > 0 && (
                <ul className="space-y-3">
                    {data.reviews.map((review) => (
                        // The key includes updatedAt so a changed review starts with fresh buttons and note
                        <ReviewItem key={`${review.id}:${review.updatedAt}`} review={review} onChanged={load} />
                    ))}
                </ul>
            )}

            {data && pages > 1 && (
                <div className="flex items-center justify-center gap-4 text-sm text-gray-300">
                    <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1} className="px-3 py-1.5 rounded-lg bg-white/5 disabled:opacity-40">
                        Previous
                    </button>
                    <span>
                        Page {page} of {pages}
                    </span>
                    <button type="button" onClick={() => setPage(page + 1)} disabled={page >= pages} className="px-3 py-1.5 rounded-lg bg-white/5 disabled:opacity-40">
                        Next
                    </button>
                </div>
            )}
        </div>
    );
}
