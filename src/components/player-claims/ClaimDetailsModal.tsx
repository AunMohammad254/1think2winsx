'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { loaderFor } from '@/lib/cloudinary';
import {
    User,
    Phone,
    MapPin,
    Calendar,
    CheckCircle,
    XCircle,
    Package,
    MessageSquare,
    Loader2,
    RotateCcw,
    RefreshCw,
    ShieldAlert,
    KeyRound,
    History,
    X,
} from 'lucide-react';
import { RISK_FLAG_LABELS, PLAYER_EVENT_LABELS } from '@/lib/claim-tracking-shared';
import { statusConfig, riskBadge, formatDate, type Claim, type DeliveryProof } from './types';

interface ClaimDetailsModalProps {
    claim: Claim;
    updating: string | null;
    onClose: () => void;
    onUpdateStatus: (
        claimId: string,
        status: string,
        notes?: string,
        action?: 'update' | 'reissue',
        reissueMode?: 'redelivery' | 'reclaim',
        overrideReason?: string
    ) => void;
    /** Mark an approved claim delivered, with the winner's handover code or a reason there is none */
    onDeliver?: (claimId: string, proof: DeliveryProof) => void;
    /** Give the winner a new handover code (the old one stops working) */
    onResetCode?: (claimId: string) => void;
}

// decide_claim wants this many characters for an override reason
const MIN_REASON = 10;
const MAX_HANDOVER_FAILURES = 5;

interface TimelineEvent {
    id: string;
    event: keyof typeof PLAYER_EVENT_LABELS;
    actor: string;
    note: string | null;
    details: { origin?: { ip?: string }; handover?: string; reason?: string; overrideReason?: string; failures?: number };
    createdAt: string;
}

/** One line of what a timeline entry's details say, for the admin */
function eventDetail({ details }: TimelineEvent): string | null {
    if (details.origin?.ip) return `From IP ${details.origin.ip}`;
    if (details.handover === 'code') return "Winner's handover code checked";
    if (details.handover === 'override') return `Without the code: ${details.reason}`;
    if (details.overrideReason) return `Approved despite the risk flags: ${details.overrideReason}`;
    if (details.failures) return `${details.failures} of ${MAX_HANDOVER_FAILURES} wrong tries`;
    return null;
}

/** What happened to the claim, oldest first; reloads when the claim changes */
function ClaimTimeline({ claim }: { claim: Claim }) {
    const [events, setEvents] = useState<TimelineEvent[] | null>(null);
    const { id, status } = claim;
    const version = claim.handover?.version;
    const failures = claim.handover?.failures;

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/admin/claims/${encodeURIComponent(id)}/timeline`)
            .then((response) => (response.ok ? response.json() : { events: [] }))
            .then((data: { events?: TimelineEvent[] }) => { if (!cancelled) setEvents(data.events ?? []); })
            .catch(() => { if (!cancelled) setEvents([]); });
        return () => { cancelled = true; };
    }, [id, status, version, failures]);

    if (!events || events.length === 0) return null;
    return (
        <div className="p-4 bg-white/5 rounded-xl">
            <h5 className="text-white font-medium flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-gray-400" />
                Timeline
            </h5>
            <ol className="space-y-2 text-sm">
                {events.map((e) => (
                    <li key={e.id} className="flex flex-col sm:flex-row sm:gap-3">
                        <span className="text-gray-500 sm:w-40 shrink-0">{formatDate(e.createdAt)}</span>
                        <span className="text-gray-200">
                            {PLAYER_EVENT_LABELS[e.event] ?? e.event}
                            <span className="text-gray-500"> · {e.actor}</span>
                            {eventDetail(e) && <span className="block text-xs text-gray-400">{eventDetail(e)}</span>}
                            {e.note && <span className="block text-xs text-gray-400">&ldquo;{e.note}&rdquo;</span>}
                        </span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

/**
 * Modal for viewing and acting on claim details
 */
export function ClaimDetailsModal({
    claim,
    updating,
    onClose,
    onUpdateStatus,
    onDeliver,
    onResetCode,
}: ClaimDetailsModalProps) {
    const [actionNotes, setActionNotes] = useState('');
    const [reissueNotes, setReissueNotes] = useState('');
    const [overrideReason, setOverrideReason] = useState('');
    const [handoverCode, setHandoverCode] = useState('');
    const [withoutCode, setWithoutCode] = useState(false);
    const [deliveryReason, setDeliveryReason] = useState('');
    const config = statusConfig[claim.status];
    const StatusIcon = config.icon;
    const risk = claim.risk;
    const badge = risk ? riskBadge[risk.level] : null;
    const highRisk = risk?.level === 'high';
    const failures = claim.handover?.failures ?? 0;
    const codeLocked = failures >= MAX_HANDOVER_FAILURES;
    const busy = updating === claim.id;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-white/10 rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-bold text-white">Claim Details</h3>
                        {claim.trackingId && (
                            <p className="font-mono text-sm tracking-wider text-amber-200" title="Tracking ID">{claim.trackingId}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Prize Info */}
                    <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl">
                        <Image
                            src={claim.prize.imageUrl}
                            loader={loaderFor(claim.prize.imageUrl)}
                            alt={claim.prize.name}
                            width={80}
                            height={80}
                            className="rounded-xl object-cover"
                        />
                        <div>
                            <h4 className="text-white font-semibold text-lg">{claim.prize.name}</h4>
                            <p className="text-gray-400 text-sm">{claim.prize.description}</p>
                            <div className="flex items-center gap-2 mt-2">
                                <span className="px-2 py-1 rounded-md bg-amber-500/20 text-amber-300 text-xs font-medium">
                                    {claim.pointsUsed} points
                                </span>
                                <span className="px-2 py-1 rounded-md bg-purple-500/20 text-purple-300 text-xs font-medium">
                                    {claim.prize.type}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Player & Claim Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <h5 className="text-white font-medium flex items-center gap-2">
                                <User className="w-4 h-4 text-gray-400" />
                                Player Information
                            </h5>
                            <div className="space-y-3 text-sm">
                                <div className="flex items-center gap-3">
                                    <span className="text-gray-400 w-24">Account:</span>
                                    <span className="text-white">{claim.user.name}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-gray-400 w-24">Email:</span>
                                    <span className="text-white">{claim.user.email}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-gray-400 w-24">Points:</span>
                                    <span className="text-amber-300 font-medium">{claim.user.points}</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h5 className="text-white font-medium flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-gray-400" />
                                Delivery Details
                            </h5>
                            <div className="space-y-3 text-sm">
                                {claim.fullName && (
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-400 w-24">Full Name:</span>
                                        <span className="text-white">{claim.fullName}</span>
                                    </div>
                                )}
                                {claim.whatsappNumber && (
                                    <div className="flex items-center gap-3">
                                        <Phone className="w-4 h-4 text-gray-400" />
                                        <span className="text-white">{claim.whatsappNumber}</span>
                                    </div>
                                )}
                                {claim.address && (
                                    <div className="flex items-start gap-3">
                                        <MapPin className="w-4 h-4 text-gray-400 mt-1" />
                                        <span className="text-white">{claim.address}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Risk flags */}
                    {risk && risk.flags.length > 0 && (
                        <div className={`p-4 rounded-xl ${highRisk ? 'bg-red-500/10 border border-red-500/30' : 'bg-amber-500/10 border border-amber-500/20'}`}>
                            <h5 className="text-white font-medium flex items-center gap-2 mb-2">
                                <ShieldAlert className={`w-4 h-4 ${highRisk ? 'text-red-300' : 'text-amber-300'}`} />
                                {badge?.label ?? 'Risk flags'}
                                <span className="text-xs font-normal text-gray-400">score {risk.score}</span>
                            </h5>
                            <ul className="space-y-1.5 text-sm">
                                {risk.flags.map((flag) => (
                                    <li key={flag.code} className="text-gray-200">
                                        {RISK_FLAG_LABELS[flag.code] ?? flag.code}
                                        {flag.accounts && flag.accounts.length > 0 && (
                                            <span className="block text-xs text-gray-400">
                                                {flag.count && flag.count > flag.accounts.length
                                                    ? `${flag.accounts.join(', ')} and ${flag.count - flag.accounts.length} more`
                                                    : flag.accounts.join(', ')}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Status & Timeline */}
                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                        <div className="flex items-center gap-3">
                            <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${config.bgClass} ${config.textClass}`}>
                                <StatusIcon className="w-4 h-4" />
                                {config.label}
                            </span>
                        </div>
                        <div className="text-right text-sm">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Calendar className="w-4 h-4" />
                                <span>Requested: {formatDate(claim.requestedAt)}</span>
                            </div>
                            {claim.processedAt && (
                                <p className="text-gray-500 mt-1">
                                    Processed: {formatDate(claim.processedAt)}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Existing Notes */}
                    {claim.notes && (
                        <div className="p-4 bg-white/5 rounded-xl">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <MessageSquare className="w-4 h-4 text-gray-400" />
                                    <span className="text-gray-300 text-sm font-medium">Admin Notes</span>
                                </div>
                                {claim.notes.includes('[REISSUED') && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                        <RotateCcw className="w-3 h-3" /> Reissued
                                    </span>
                                )}
                            </div>
                            <p className="text-white text-sm">{claim.notes}</p>
                        </div>
                    )}

                    {/* Actions for Pending */}
                    {claim.status === 'pending' && (
                        <div className="space-y-4 pt-4 border-t border-white/10">
                            <div>
                                <label htmlFor="claim-action-notes" className="text-sm text-gray-400 mb-2 block">Note to the player (optional)</label>
                                <textarea
                                    id="claim-action-notes"
                                    value={actionNotes}
                                    onChange={(e) => setActionNotes(e.target.value)}
                                    placeholder="Sent to the player with your decision, e.g. the delivery date or why it was rejected"
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 resize-none"
                                    rows={2}
                                />
                            </div>
                            {highRisk && (
                                <div>
                                    <label htmlFor="claim-override-reason" className="text-sm text-red-300 mb-2 block">
                                        Why approve despite the flags? (required, kept on the timeline)
                                    </label>
                                    <textarea
                                        id="claim-override-reason"
                                        value={overrideReason}
                                        onChange={(e) => setOverrideReason(e.target.value)}
                                        placeholder="e.g. Brothers sharing a house: checked both CNICs on a video call"
                                        className="w-full px-4 py-3 bg-white/5 border border-red-500/30 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-red-400/60 resize-none"
                                        rows={2}
                                    />
                                </div>
                            )}
                            <div className="flex gap-3">
                                <button
                                    onClick={() => onUpdateStatus(claim.id, 'approved', actionNotes, 'update', undefined, highRisk ? overrideReason.trim() : undefined)}
                                    disabled={busy || (highRisk && overrideReason.trim().length < MIN_REASON)}
                                    className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
                                >
                                    {updating === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                    Approve Claim
                                </button>
                                <button
                                    onClick={() => onUpdateStatus(claim.id, 'rejected', actionNotes)}
                                    disabled={updating === claim.id}
                                    className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
                                >
                                    <XCircle className="w-4 h-4" />
                                    Reject Claim
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Delivery for Approved: the winner's handover code proves the prize reached them */}
                    {claim.status === 'approved' && onDeliver && (
                        <div className="space-y-3 pt-4 border-t border-white/10">
                            <h5 className="text-white font-medium flex items-center gap-2">
                                <KeyRound className="w-4 h-4 text-emerald-400" />
                                Confirm delivery
                            </h5>
                            <p className="text-xs text-gray-400">
                                The winner sees a 6-digit handover code on their profile and gives it to whoever hands over the prize.
                                {failures > 0 && ` ${failures} of ${MAX_HANDOVER_FAILURES} wrong tries used.`}
                            </p>
                            {codeLocked ? (
                                <p role="alert" className="text-sm text-red-300">Too many wrong codes. Reset the code, then ask the winner for the new one.</p>
                            ) : (
                                <div className="flex gap-3">
                                    <input
                                        aria-label="Winner's handover code"
                                        inputMode="numeric"
                                        autoComplete="off"
                                        maxLength={7}
                                        value={handoverCode}
                                        onChange={(e) => setHandoverCode(e.target.value.replace(/[^\d ]/g, ''))}
                                        placeholder="123 456"
                                        className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-mono tracking-widest placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
                                    />
                                    <button
                                        onClick={() => onDeliver(claim.id, { handoverCode: handoverCode.trim() })}
                                        disabled={busy || handoverCode.replace(/\s/g, '').length !== 6}
                                        className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
                                    >
                                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                                        Confirm Delivery
                                    </button>
                                </div>
                            )}
                            <div className="flex flex-wrap gap-4 text-xs">
                                <button type="button" onClick={() => setWithoutCode((v) => !v)} className="text-gray-400 hover:text-white underline-offset-2 hover:underline">
                                    Delivered without the code?
                                </button>
                                {onResetCode && (
                                    <button type="button" onClick={() => onResetCode(claim.id)} disabled={busy} className="text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline disabled:opacity-50">
                                        Reset the handover code
                                    </button>
                                )}
                            </div>
                            {withoutCode && (
                                <div className="space-y-2">
                                    <label htmlFor="claim-delivery-reason" className="text-xs text-gray-400 block">
                                        Why there is no code (required, kept on the timeline)
                                    </label>
                                    <textarea
                                        id="claim-delivery-reason"
                                        value={deliveryReason}
                                        onChange={(e) => setDeliveryReason(e.target.value)}
                                        placeholder="e.g. Winner lost their phone: confirmed their CNIC at the door"
                                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50 resize-none text-sm"
                                        rows={2}
                                    />
                                    <button
                                        onClick={() => onDeliver(claim.id, { overrideReason: deliveryReason.trim() })}
                                        disabled={busy || deliveryReason.trim().length < MIN_REASON}
                                        className="w-full px-4 py-2.5 bg-white/10 hover:bg-white/15 text-white rounded-xl transition-colors disabled:opacity-50 text-sm font-medium"
                                    >
                                        Mark Delivered Without Code
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Reissue Item Section (approved or fulfilled claims, when the player has a problem).
                        Not for rejected claims: their points were refunded, and the player can simply claim again. */}
                    {(claim.status === 'fulfilled' || claim.status === 'approved') && (
                        <div className="space-y-4 pt-4 border-t border-white/10">
                            <div className="flex items-center justify-between">
                                <h5 className="text-white font-medium flex items-center gap-2">
                                    <RotateCcw className="w-4 h-4 text-amber-400" />
                                    Reissue Item (Issue Resolution)
                                </h5>
                                <span className="text-xs text-amber-300/80 bg-amber-500/10 px-2 py-1 rounded-md border border-amber-500/20">
                                    Admin Controls
                                </span>
                            </div>
                            <p className="text-xs text-gray-400">
                                If the player encountered issues (e.g. delivery failure, lost package, or defective item), you can reissue the prize for re-delivery or reset it so they can claim again.
                            </p>

                            <div>
                                <label className="text-xs text-gray-400 mb-1.5 block">Reissue Reason / Notes</label>
                                <textarea
                                    value={reissueNotes}
                                    onChange={(e) => setReissueNotes(e.target.value)}
                                    placeholder="Enter reason for reissue (e.g., Courier returned package, replacement requested)..."
                                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50 resize-none text-sm"
                                    rows={2}
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <button
                                    onClick={() => onUpdateStatus(claim.id, 'pending', reissueNotes, 'reissue', 'redelivery')}
                                    disabled={updating === claim.id}
                                    className="px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium text-sm shadow-sm"
                                >
                                    {updating === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                    Reissue for Re-Delivery
                                </button>
                                <button
                                    onClick={() => onUpdateStatus(claim.id, 'rejected', reissueNotes, 'reissue', 'reclaim')}
                                    disabled={updating === claim.id}
                                    className="px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium text-sm shadow-sm"
                                >
                                    {updating === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                    Reissue & Allow Re-Claim
                                </button>
                            </div>
                        </div>
                    )}

                    <ClaimTimeline claim={claim} />
                </div>
            </div>
        </div>
    );
}
