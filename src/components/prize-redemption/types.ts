'use client';

// ============================================
// Types for Prize Redemption
// ============================================

export interface Prize {
    id: string;
    name: string;
    description: string;
    imageUrl: string;
    modelUrl: string;
    type: string;
    pointsRequired: number;
}

export interface RedemptionHistory {
    id: string;
    pointsUsed: number;
    status: string;
    requestedAt: string;
    processedAt?: string;
    notes?: string;
    prize: {
        name: string;
        description: string;
        imageUrl: string;
        type: string;
    };
}

export interface RedemptionFormData {
    name: string;
    whatsappNumber: string;
    address: string;
}

// ============================================
// Helper Functions
// ============================================
export function getStatusColor(status: string): string {
    switch (status) {
        case 'pending':
            return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
        case 'approved':
            return 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
        case 'fulfilled':
            return 'bg-green-500/20 text-green-300 border border-green-500/30';
        case 'rejected':
            return 'bg-red-500/20 text-red-300 border border-red-500/30';
        default:
            return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
    }
}

export async function getCSRFToken(): Promise<string | null> {
    try {
        const response = await fetch('/api/csrf-token');
        if (!response.ok) throw new Error('Failed to fetch CSRF token');
        const data = await response.json();
        return data.csrfToken;
    } catch {
        return null;
    }
}
