'use client';

// ============================================
// Types for Player Claims Manager
// ============================================

export interface UserData {
    id: string;
    name: string;
    email: string;
    phone: string;
    points: number;
}

export interface Prize {
    id: string;
    name: string;
    description: string;
    imageUrl: string;
    type: string;
    pointsRequired: number;
}

export interface Claim {
    id: string;
    /** 1T2W-XXXX-XXXX; missing only from the fallback list on a database without the tracking migration */
    trackingId?: string;
    pointsUsed: number;
    status: ClaimStatus;
    fullName: string | null;
    whatsappNumber: string | null;
    address: string | null;
    requestedAt: string;
    processedAt: string | null;
    notes: string | null;
    user: UserData;
    prize: Prize;
    /** The quiz the prize was won in (a delivery claim, 0 points); missing or null for one bought with points */
    quiz?: { id: string; title: string } | null;
    /** Risk flags worked out by the database (claim_risk) */
    risk?: ClaimRisk | null;
    /** Which handover code is current, and how many wrong ones were entered for it */
    handover?: { version: number; failures: number } | null;
}

/** Options for marking a claim delivered: the winner's code, or why there is none */
export type DeliveryProof = { handoverCode: string } | { overrideReason: string };

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled';

export interface PaginationInfo {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// ============================================
// Status Configuration
// ============================================
import { CheckCircle, Clock, Package, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ClaimRisk, RiskLevel } from '@/lib/claim-tracking-shared';

export const riskBadge: Record<RiskLevel, { label: string; className: string } | null> = {
    low: null,
    medium: { label: 'Check details', className: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' },
    high: { label: 'High risk', className: 'bg-red-500/20 text-red-300 border border-red-500/40' },
};

export interface StatusConfig {
    label: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
    icon: LucideIcon;
}

export const statusConfig: Record<ClaimStatus, StatusConfig> = {
    pending: {
        label: 'Pending Review',
        bgClass: 'bg-amber-500/20',
        textClass: 'text-amber-300',
        borderClass: 'border-amber-500/30',
        icon: Clock,
    },
    approved: {
        label: 'Approved',
        bgClass: 'bg-blue-500/20',
        textClass: 'text-blue-300',
        borderClass: 'border-blue-500/30',
        icon: CheckCircle,
    },
    fulfilled: {
        label: 'Fulfilled',
        bgClass: 'bg-emerald-500/20',
        textClass: 'text-emerald-300',
        borderClass: 'border-emerald-500/30',
        icon: Package,
    },
    rejected: {
        label: 'Rejected',
        bgClass: 'bg-red-500/20',
        textClass: 'text-red-300',
        borderClass: 'border-red-500/30',
        icon: XCircle,
    },
};

// ============================================
// Helper Functions
// ============================================
export function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
