// Prize Types for the Prizes Module
// These types ensure type safety across the entire data flow

// ============================================
// Type Definitions (must come before interfaces)
// ============================================

// Actual prize category values (for prize data and forms)
export type PrizeCategoryValue = 'electronics' | 'vehicles' | 'accessories' | 'general';

// Prize categories for filtering (includes 'all' option)
export type PrizeCategory = 'all' | PrizeCategoryValue;

// Prize status for admin management
export type PrizeStatus = 'draft' | 'published';

// Redemption status
export type RedemptionStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled';

// Sort options for public view
export type PrizeSortOption = 'points-asc' | 'points-desc' | 'newest' | 'oldest' | 'name-asc';

// ============================================
// Interfaces
// ============================================

export interface Prize {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    modelUrl: string | null;
    type: string;
    pointsRequired: number;
    isActive: boolean;
    category: PrizeCategoryValue;
    stock: number;
    status: PrizeStatus;
    value: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface PrizeWithRedemptions extends Prize {
    redemptions: PrizeRedemption[];
    winnings: PrizeWinning[];
}

export interface PrizeRedemption {
    id: string;
    userId: string;
    prizeId: string;
    pointsUsed: number;
    status: RedemptionStatus;
    fullName: string | null;
    whatsappNumber: string | null;
    address: string | null;
    requestedAt: Date;
    processedAt: Date | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface PrizeWinning {
    id: string;
    userId: string;
    quizId: string;
    prizeId: string;
    claimed: boolean;
    createdAt: Date;
    updatedAt: Date;
}

// Form data for creating/updating prizes
export interface PrizeFormData {
    name: string;
    description: string;
    imageUrl: string;
    modelUrl?: string;
    type: string;
    pointsRequired: number;
    category: PrizeCategoryValue;
    stock: number;
    status: PrizeStatus;
    value: number;
}

// Validation schema input type
export interface PrizeInput {
    name: string;
    description?: string;
    imageUrl?: string;
    modelUrl?: string;
    type: string;
    pointsRequired: number;
    category?: PrizeCategoryValue;
    stock?: number;
    status?: PrizeStatus;
    value?: number;
}

// Filter state for public view
export interface PrizeFilters {
    category: PrizeCategory;
    sortBy: PrizeSortOption;
    search?: string;
}

// Admin filter state
export interface AdminPrizeFilters extends PrizeFilters {
    status: PrizeStatus | 'all';
    showInactive: boolean;
}

// API Response types
export interface PrizeResponse {
    success: boolean;
    data?: Prize;
    error?: string;
    message?: string;
}

export interface PrizesResponse {
    success: boolean;
    data?: Prize[];
    error?: string;
    message?: string;
}

// Optimistic update state
export interface OptimisticPrize extends Prize {
    isOptimistic?: boolean;
    previousState?: Prize;
}

// Redemption form data
export interface RedemptionFormData {
    prizeId: string;
    fullName: string;
    whatsappNumber: string;
    address: string;
}

// ============================================
// Constants
// ============================================

// Category metadata for UI
export const PRIZE_CATEGORIES: { value: PrizeCategory; label: string; icon: string }[] = [
    { value: 'all', label: 'All Prizes', icon: '🎁' },
    { value: 'electronics', label: 'Electronics', icon: '📱' },
    { value: 'vehicles', label: 'Vehicles', icon: '🏍️' },
    { value: 'accessories', label: 'Accessories', icon: '🎧' },
    { value: 'general', label: 'General', icon: '🎯' },
];

// Sort options metadata for UI
export const SORT_OPTIONS: { value: PrizeSortOption; label: string }[] = [
    { value: 'points-asc', label: 'Lowest Points' },
    { value: 'points-desc', label: 'Highest Points' },
    { value: 'newest', label: 'Newest First' },
    { value: 'oldest', label: 'Oldest First' },
    { value: 'name-asc', label: 'Name (A-Z)' },
];

// Status badge colors
export const STATUS_COLORS: Record<PrizeStatus, { bg: string; text: string; border: string }> = {
    draft: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
    published: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
};

// Redemption status colors
export const REDEMPTION_STATUS_COLORS: Record<RedemptionStatus, { bg: string; text: string; border: string }> = {
    pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
    approved: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
    rejected: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
    fulfilled: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
};
