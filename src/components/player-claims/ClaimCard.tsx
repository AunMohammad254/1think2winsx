'use client';

import Image from 'next/image';
import { loaderFor } from '@/lib/cloudinary';
import {
    Eye,
    MessageSquare,
    CheckCircle,
    XCircle,
    Package,
    Loader2,
    RotateCcw,
    ShieldAlert,
} from 'lucide-react';
import { statusConfig, riskBadge, formatDate, type Claim } from './types';

interface ClaimCardProps {
    claim: Claim;
    updating: string | null;
    onViewDetails: (claim: Claim) => void;
    onUpdateStatus: (claimId: string, status: string, notes?: string) => void;
}

/**
 * Individual claim card with actions
 */
export function ClaimCard({ claim, updating, onViewDetails, onUpdateStatus }: ClaimCardProps) {
    const config = statusConfig[claim.status];
    const StatusIcon = config.icon;
    const risk = claim.risk ? riskBadge[claim.risk.level] : null;
    // A high-risk approval needs a written reason, which only the details screen takes
    const approveNeedsReason = claim.risk?.level === 'high';

    return (
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/60 to-gray-800/40 p-6 transition-all duration-300 hover:border-white/20">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                {/* Player & Prize */}
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <Image
                            src={claim.prize.imageUrl}
                            loader={loaderFor(claim.prize.imageUrl)}
                            alt={claim.prize.name}
                            width={64}
                            height={64}
                            className="rounded-xl object-cover shadow-lg"
                        />
                        <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg">
                            {claim.user.name?.charAt(0) || '?'}
                        </div>
                    </div>
                    <div>
                        <p className="text-white font-semibold text-lg">{claim.prize.name}</p>
                        <p className="text-gray-400 text-sm">{claim.user.name} • {claim.user.email}</p>
                        <p className="text-amber-300 text-sm font-medium">
                            {claim.quiz ? <>🏆 Won in &ldquo;{claim.quiz.title}&rdquo;</> : `${claim.pointsUsed} points`}
                        </p>
                        {claim.trackingId && (
                            <p className="font-mono text-xs tracking-wider text-gray-400" title="Tracking ID">{claim.trackingId}</p>
                        )}
                    </div>
                </div>

                {/* Details */}
                <div className="flex flex-wrap gap-4 items-center">
                    <div>
                        <p className="text-gray-500 text-xs uppercase">Requested</p>
                        <p className="text-white text-sm">{formatDate(claim.requestedAt)}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${config.bgClass} ${config.textClass}`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        {config.label}
                    </span>
                    {claim.notes?.includes('[REISSUED') && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <RotateCcw className="w-3 h-3" /> Reissued
                        </span>
                    )}
                    {risk && (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${risk.className}`}>
                            <ShieldAlert className="w-3 h-3" /> {risk.label}
                        </span>
                    )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-shrink-0">
                    <button
                        onClick={() => onViewDetails(claim)}
                        className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2"
                    >
                        <Eye className="w-4 h-4" />
                        Details
                    </button>
                    {/* Rejected claims were refunded already, so only a delivered one can be reissued here */}
                    {claim.status === 'fulfilled' && (
                        <button
                            onClick={() => onViewDetails(claim)}
                            className="px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 transition-all flex items-center gap-1.5 text-xs font-medium"
                            title="Reissue this item if the user encounters any issues"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Reissue
                        </button>
                    )}
                    {claim.status === 'pending' && (
                        <>
                            <button
                                onClick={() => (approveNeedsReason ? onViewDetails(claim) : onUpdateStatus(claim.id, 'approved'))}
                                disabled={updating === claim.id}
                                title={approveNeedsReason ? 'High risk: approve from the details, with a reason' : undefined}
                                className="px-4 py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                {updating === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                Approve
                            </button>
                            <button
                                onClick={() => onUpdateStatus(claim.id, 'rejected')}
                                disabled={updating === claim.id}
                                className="px-4 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                <XCircle className="w-4 h-4" />
                                Reject
                            </button>
                        </>
                    )}
                    {/* Delivery needs the winner's handover code, which the details screen takes */}
                    {claim.status === 'approved' && (
                        <button
                            onClick={() => onViewDetails(claim)}
                            disabled={updating === claim.id}
                            className="px-4 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                            {updating === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                            Confirm Delivery
                        </button>
                    )}
                </div>
            </div>

            {/* Notes */}
            {claim.notes && (
                <div className="mt-4 p-3 bg-white/5 rounded-xl flex gap-2">
                    <MessageSquare className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                    <p className="text-gray-300 text-sm">{claim.notes}</p>
                </div>
            )}
        </div>
    );
}
