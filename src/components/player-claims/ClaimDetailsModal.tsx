'use client';

import { useState } from 'react';
import Image from 'next/image';
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
    X,
} from 'lucide-react';
import { statusConfig, formatDate, type Claim } from './types';

interface ClaimDetailsModalProps {
    claim: Claim;
    updating: string | null;
    onClose: () => void;
    onUpdateStatus: (claimId: string, status: string, notes?: string) => void;
}

/**
 * Modal for viewing and acting on claim details
 */
export function ClaimDetailsModal({
    claim,
    updating,
    onClose,
    onUpdateStatus,
}: ClaimDetailsModalProps) {
    const [actionNotes, setActionNotes] = useState('');
    const config = statusConfig[claim.status];
    const StatusIcon = config.icon;

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
                    <h3 className="text-xl font-bold text-white">Claim Details</h3>
                    <button
                        onClick={onClose}
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
                            <div className="flex items-center gap-2 mb-2">
                                <MessageSquare className="w-4 h-4 text-gray-400" />
                                <span className="text-gray-300 text-sm font-medium">Admin Notes</span>
                            </div>
                            <p className="text-white text-sm">{claim.notes}</p>
                        </div>
                    )}

                    {/* Actions for Pending */}
                    {claim.status === 'pending' && (
                        <div className="space-y-4 pt-4 border-t border-white/10">
                            <div>
                                <label className="text-sm text-gray-400 mb-2 block">Add notes (optional)</label>
                                <textarea
                                    value={actionNotes}
                                    onChange={(e) => setActionNotes(e.target.value)}
                                    placeholder="Add any notes about this claim..."
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 resize-none"
                                    rows={2}
                                />
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => onUpdateStatus(claim.id, 'approved', actionNotes)}
                                    disabled={updating === claim.id}
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

                    {/* Action for Approved */}
                    {claim.status === 'approved' && (
                        <div className="pt-4 border-t border-white/10">
                            <button
                                onClick={() => onUpdateStatus(claim.id, 'fulfilled')}
                                disabled={updating === claim.id}
                                className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
                            >
                                {updating === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                                Mark as Fulfilled / Delivered
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
