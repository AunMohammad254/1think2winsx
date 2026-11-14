'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { CheckCircle2, Clock, Loader2, MessageSquareQuote, XCircle } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/contexts/AuthContext';
import { getCSRFHeaders } from '@/lib/csrf';
import {
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN,
  REVIEW_NAME_MAX,
  REVIEW_STATUS_LABELS,
  defaultDisplayName,
  reviewInputSchema,
  type OwnReview,
} from '@/lib/reviews';
import { StarInput } from './StarRating';

interface ReviewModalProps {
  open: boolean;
  onClose: () => void;
  /** After a review was sent (it now waits for approval) */
  onSubmitted?: (review: OwnReview) => void;
}

type LoadState = 'loading' | 'ready' | 'error';

const inputClass =
  'mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-white placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:opacity-60';

/** Where the player's review stands, above the form */
function StatusNotice({ review }: { review: OwnReview }) {
  const styles = {
    pending: { icon: Clock, box: 'border-amber-500/30 bg-amber-500/10 text-amber-200', text: 'Our team will check it soon. Editing it keeps it in the queue.' },
    approved: { icon: CheckCircle2, box: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200', text: 'It shows on our home page. If you edit it, it is checked again before it reappears.' },
    rejected: { icon: XCircle, box: 'border-red-500/30 bg-red-500/10 text-red-200', text: 'You can edit it below and send it again.' },
  }[review.status];
  const Icon = styles.icon;
  return (
    <div role="status" className={`mb-5 flex gap-3 rounded-2xl border p-3 text-sm ${styles.box}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">Your review: {REVIEW_STATUS_LABELS[review.status]}</p>
        {review.status === 'rejected' && review.moderationNote && <p className="mt-1">Reason: {review.moderationNote}</p>}
        <p className="mt-1 opacity-80">{styles.text}</p>
      </div>
    </div>
  );
}

/**
 * Write (or edit) the player's one review of 1Think 2Win. It is sent to /api/reviews and shows on the
 * home page only after an admin approves it on /admin/reviews.
 */
export default function ReviewModal({ open, onClose, onSubmitted }: ReviewModalProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [existing, setExisting] = useState<OwnReview | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const userId = user?.id;
  const accountName = (user?.user_metadata?.name || user?.user_metadata?.full_name || '') as string;

  // Each time it opens: load the player's review, if they wrote one, into the form
  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setLoadState('loading');
    setError(null);
    setSent(false);
    fetch('/api/reviews/mine')
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { review: OwnReview | null };
        if (cancelled) return;
        setExisting(data.review);
        setRating(data.review?.rating ?? 0);
        setComment(data.review?.comment ?? '');
        setDisplayName(data.review?.displayName ?? defaultDisplayName(accountName));
        setCity(data.review?.city ?? '');
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, userId, accountName]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = reviewInputSchema.safeParse({ rating, comment, displayName, city });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getCSRFHeaders()) },
        body: JSON.stringify({ rating, comment, displayName, city }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not save your review. Please try again.');
        return;
      }
      setExisting(data.review);
      setSent(true);
      toast.success('Thanks for your review!');
      onSubmitted?.(data.review);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const icon = (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-500/15 text-amber-300">
      <MessageSquareQuote className="h-5 w-5" aria-hidden="true" />
    </span>
  );

  let body: React.ReactNode;
  if (authLoading || (userId && loadState === 'loading')) {
    body = (
      <p className="flex items-center justify-center gap-2 py-10 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading…
      </p>
    );
  } else if (!userId) {
    body = (
      <div className="py-4 text-center">
        <p className="text-slate-300">Sign in to rate 1Think 2Win and tell other fans what you think.</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/login" prefetch={false} onClick={onClose} className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-6 py-2.5 font-semibold text-white">
            Sign in
          </Link>
          <Link href="/register" prefetch={false} onClick={onClose} className="rounded-xl border border-white/15 bg-white/5 px-6 py-2.5 font-semibold text-white hover:bg-white/10">
            Create an account
          </Link>
        </div>
      </div>
    );
  } else if (loadState === 'error') {
    body = (
      <p role="alert" className="py-8 text-center text-red-300">
        We couldn&apos;t load your review. Close this window and try again in a moment.
      </p>
    );
  } else if (sent) {
    body = (
      <div className="py-6 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" aria-hidden="true" />
        <p className="mt-4 text-lg font-semibold text-white">Thanks for your review!</p>
        <p className="mt-2 text-sm text-slate-400">
          Our team checks every review before it goes on the home page. We&apos;ll send you a notification once it&apos;s approved.
        </p>
        <button type="button" onClick={onClose} className="mt-6 rounded-xl bg-white/10 px-6 py-2.5 font-semibold text-white hover:bg-white/15">
          Done
        </button>
      </div>
    );
  } else {
    body = (
      <form onSubmit={submit} noValidate>
        {existing && <StatusNotice review={existing} />}
        <fieldset disabled={submitting} className="space-y-5">
          <div>
            <legend className="text-sm font-medium text-slate-200">How would you rate 1Think 2Win?</legend>
            <div className="mt-2">
              <StarInput value={rating} onChange={setRating} disabled={submitting} />
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-200">Your review</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={REVIEW_COMMENT_MAX}
              rows={4}
              placeholder="What do you enjoy? What could be better?"
              className={inputClass}
            />
            <span className="mt-1 flex justify-between text-xs text-slate-500">
              <span>At least {REVIEW_COMMENT_MIN} characters</span>
              <span>{comment.length}/{REVIEW_COMMENT_MAX}</span>
            </span>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-200">Name to show</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={REVIEW_NAME_MAX} autoComplete="nickname" className={inputClass} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-200">
                City <span className="font-normal text-slate-500">(optional)</span>
              </span>
              <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={REVIEW_NAME_MAX} autoComplete="address-level2" placeholder="e.g. Karachi" className={inputClass} />
            </label>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}

          <p className="text-xs text-slate-500">Reviews appear on our home page after our team approves them. Please leave out phone numbers and links.</p>

          <button
            type="submit"
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 font-semibold text-white shadow-lg shadow-emerald-500/20 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {existing ? 'Update my review' : 'Send review'}
          </button>
        </fieldset>
      </form>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Your review' : 'Write a review'}
      description="Your honest opinion helps other sports fans."
      icon={icon}
      dismissible={!submitting}
      className="max-w-lg"
    >
      {body}
    </Modal>
  );
}
