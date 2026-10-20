'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Search, X } from 'lucide-react';
import { listSupportTicketsAction, updateSupportTicketAction, type ListTicketsResult } from '@/actions/support-ticket-actions';
import type { AdminTicket } from '@/lib/supabase/db-modules/support-ticket.db';
import { TICKET_REPLY_MAX, TICKET_STATUSES, TICKET_STATUS_LABELS, type TicketStatus } from '@/lib/support-tickets';

type Filter = TicketStatus | 'all';
type Loaded = Extract<ListTicketsResult, { success: true }>;

const STATUS_STYLES: Record<TicketStatus, string> = {
    open: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    in_progress: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    resolved: 'bg-green-500/15 text-green-300 border-green-500/30',
    closed: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
};

const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' });

function StatusBadge({ status }: { status: TicketStatus }) {
    return (
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status]}`}>
            {TICKET_STATUS_LABELS[status]}
        </span>
    );
}

/** One ticket: what the player wrote, and the status and reply the player sees through the chatbot */
function TicketDetails({ ticket, onClose, onSaved }: { ticket: AdminTicket; onClose: () => void; onSaved: () => void }) {
    const [status, setStatus] = useState<TicketStatus>(ticket.status);
    const [reply, setReply] = useState(ticket.adminReply ?? '');
    const [saving, setSaving] = useState(false);

    async function save() {
        setSaving(true);
        const result = await updateSupportTicketAction({ id: ticket.id, status, adminReply: reply }).catch(
            () => ({ success: false, error: 'Failed to update the ticket' }) as const,
        );
        setSaving(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        toast.success(result.notified ? 'Ticket updated. The player has been notified.' : 'Ticket updated');
        onSaved();
    }

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-label={`Ticket ${ticket.ticketNumber}`}
                className="w-full sm:max-w-2xl max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-gray-900 border border-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 p-5 border-b border-white/10">
                    <div className="min-w-0">
                        <p className="font-mono text-sm text-amber-300">{ticket.ticketNumber}</p>
                        <h2 className="text-lg font-semibold text-white break-words">{ticket.subject}</h2>
                        <p className="text-sm text-gray-400 break-all">
                            {ticket.user ? `${ticket.user.name || 'No name'} · ${ticket.user.email}` : 'Player account deleted'}
                        </p>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                            What the player said · {formatWhen(ticket.createdAt)}
                        </p>
                        <p className="text-sm text-gray-200 whitespace-pre-wrap break-words rounded-xl bg-white/5 border border-white/10 p-3">
                            {ticket.message}
                        </p>
                    </div>

                    <label className="block">
                        <span className="text-sm font-medium text-gray-300">Status</span>
                        <select
                            value={status}
                            onChange={(e) => setStatus(e.target.value as TicketStatus)}
                            className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white"
                        >
                            {TICKET_STATUSES.map((s) => (
                                <option key={s} value={s} className="bg-gray-800">
                                    {TICKET_STATUS_LABELS[s]}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="block">
                        <span className="text-sm font-medium text-gray-300">Reply to the player</span>
                        <textarea
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                            maxLength={TICKET_REPLY_MAX}
                            rows={5}
                            placeholder="The player sees this when they ask the chatbot about their ticket"
                            className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500"
                        />
                        <span className="block text-right text-xs text-gray-500">
                            {reply.length}/{TICKET_REPLY_MAX}
                            {ticket.repliedAt && ` · last reply ${formatWhen(ticket.repliedAt)}`}
                        </span>
                    </label>
                </div>

                <div className="flex justify-end gap-2 p-5 border-t border-white/10">
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-gray-300 hover:bg-white/10">
                        Cancel
                    </button>
                    <button
                        onClick={save}
                        disabled={saving}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-gray-950 font-semibold disabled:opacity-50"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function SupportTicketsManager() {
    const [filter, setFilter] = useState<Filter>('open');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [data, setData] = useState<Loaded | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<AdminTicket | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await listSupportTicketsAction({ status: filter === 'all' ? undefined : filter, search, page });
            if (result.success) {
                setData(result);
                setError(null);
            } else {
                setError(result.error);
            }
        } catch {
            setError('Failed to load tickets');
        }
        setLoading(false);
    }, [filter, search, page]);

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
            {/* Status filter with totals */}
            <div className="flex flex-wrap gap-2">
                {(['all', ...TICKET_STATUSES] as Filter[]).map((f) => (
                    <button
                        key={f}
                        onClick={() => choose(f)}
                        aria-pressed={filter === f}
                        className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                            filter === f ? 'bg-amber-500/20 border-amber-500/50 text-amber-200' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                        }`}
                    >
                        {f === 'all' ? 'All' : TICKET_STATUS_LABELS[f]}
                        {data && f !== 'all' && <span className="ml-2 text-xs opacity-70">{data.counts[f]}</span>}
                    </button>
                ))}
            </div>

            {/* Find one ticket by the number a player quotes */}
            <form
                className="flex gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    setSearch(searchInput.trim());
                    setPage(1);
                }}
            >
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Find a ticket number, e.g. TKT-7KQ2XM"
                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-400"
                    />
                </div>
                <button type="submit" className="px-4 rounded-xl bg-white/10 text-white hover:bg-white/20">
                    Find
                </button>
                <button type="button" onClick={load} aria-label="Refresh" className="px-3 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10">
                    <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </form>

            {error && (
                <div role="alert" className="flex items-center justify-between gap-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200">
                    <span>{error}</span>
                    <button onClick={load} className="underline">
                        Try again
                    </button>
                </div>
            )}

            {!data && loading && <p className="text-gray-400">Loading tickets…</p>}

            {data && data.tickets.length === 0 && (
                <p className="p-8 text-center rounded-xl bg-white/5 border border-white/10 text-gray-400">No tickets here.</p>
            )}

            {data && data.tickets.length > 0 && (
                <ul className="space-y-3">
                    {data.tickets.map((ticket) => (
                        <li key={ticket.id}>
                            <button
                                onClick={() => setSelected(ticket)}
                                className="w-full text-left p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                            >
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <span className="font-mono text-sm text-amber-300">{ticket.ticketNumber}</span>
                                    <StatusBadge status={ticket.status} />
                                    {ticket.adminReply && <span className="text-xs text-gray-400">Replied</span>}
                                    <span className="ml-auto text-xs text-gray-500">{formatWhen(ticket.createdAt)}</span>
                                </div>
                                <p className="mt-1 text-white font-medium break-words">{ticket.subject}</p>
                                <p className="text-sm text-gray-400 break-all">{ticket.user?.email ?? 'Player account deleted'}</p>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {data && pages > 1 && (
                <div className="flex items-center justify-center gap-4 text-sm text-gray-300">
                    <button onClick={() => setPage(page - 1)} disabled={page <= 1} className="px-3 py-1.5 rounded-lg bg-white/5 disabled:opacity-40">
                        Previous
                    </button>
                    <span>
                        Page {page} of {pages}
                    </span>
                    <button onClick={() => setPage(page + 1)} disabled={page >= pages} className="px-3 py-1.5 rounded-lg bg-white/5 disabled:opacity-40">
                        Next
                    </button>
                </div>
            )}

            {selected && (
                <TicketDetails
                    ticket={selected}
                    onClose={() => setSelected(null)}
                    onSaved={() => {
                        setSelected(null);
                        load();
                    }}
                />
            )}
        </div>
    );
}
