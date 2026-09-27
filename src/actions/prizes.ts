'use server';

import { adminActionGuard } from '@/lib/admin-guard';

import { prizeDb, getDb, getAdminDb } from '@/lib/supabase/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type {
    Prize,
    PrizeFormData,
    PrizeCategory,
    PrizeSortOption,
    PrizeStatus
} from '@/types/prize';

// Validation schemas
const prizeSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    description: z.string().max(500, 'Description too long').optional(),
    imageUrl: z.string().url('Invalid image URL').optional().or(z.literal('')),
    modelUrl: z.string().url('Invalid model URL').optional().or(z.literal('')),
    type: z.string().min(1, 'Type is required'),
    pointsRequired: z.number().min(1, 'Points must be at least 1'),
    category: z.enum(['electronics', 'vehicles', 'accessories', 'general']).default('general'),
    stock: z.number().min(0, 'Stock cannot be negative').default(0),
    status: z.enum(['draft', 'published']).default('published'),
    value: z.number().min(0, 'Value cannot be negative').default(0),
});

const redemptionSchema = z.object({
    prizeId: z.string().min(1, 'Prize ID is required'),
    fullName: z.string().min(2, 'Full name is required'),
    whatsappNumber: z.string().min(10, 'Valid WhatsApp number is required'),
    address: z.string().min(10, 'Complete address is required'),
});

// ============ PUBLIC ACTIONS ============

/**
 * Get all published and active prizes for the public view
 */
export async function getPublicPrizes(
    category: PrizeCategory = 'all',
    sortBy: PrizeSortOption = 'points-asc'
): Promise<{ success: boolean; data?: Prize[]; error?: string }> {
    try {
        const supabase = await getDb();

        // Build the query
        let query = supabase
            .from('Prize')
            .select('*')
            .eq('isActive', true)
            .eq('status', 'published');

        if (category !== 'all') {
            query = query.eq('category', category);
        }

        // Apply ordering
        switch (sortBy) {
            case 'points-desc':
                query = query.order('pointsRequired', { ascending: false });
                break;
            case 'newest':
                query = query.order('createdAt', { ascending: false });
                break;
            case 'oldest':
                query = query.order('createdAt', { ascending: true });
                break;
            case 'name-asc':
                query = query.order('name', { ascending: true });
                break;
            default:
                query = query.order('pointsRequired', { ascending: true });
        }

        const { data: prizes, error } = await query;

        if (error) throw error;

        return { success: true, data: prizes as Prize[] };
    } catch (error) {
        console.error('Error fetching public prizes:', error);
        return { success: false, error: 'Failed to fetch prizes' };
    }
}

/**
 * Redeem a prize (user action with optimistic UI support)
 */
export async function redeemPrize(
    _userId: string,
    formData: {
        prizeId: string;
        fullName: string;
        whatsappNumber: string;
        address: string;
    }
): Promise<{ success: boolean; data?: unknown; error?: string }> {
    // SECURITY: `_userId` used to be trusted from the browser, letting anyone spend
    // another player's points. The user is now taken from the verified session and
    // the whole redemption runs atomically in the `redeem_prize` DB function
    // (points were previously read-then-written, so double-clicks could double-spend).
    try {
        const validation = redemptionSchema.safeParse(formData);
        if (!validation.success) {
            return {
                success: false,
                error: validation.error.issues[0]?.message || 'Invalid input'
            };
        }

        const supabase = await getDb();
        const { data: claims } = await supabase.auth.getClaims();
        const userId = claims?.claims?.sub;
        if (!userId) {
            return { success: false, error: 'You must be logged in to redeem prizes' };
        }

        const { prizeId, fullName, whatsappNumber, address } = validation.data;

        const { data: existingRedemption } = await supabase
            .from('PrizeRedemption')
            .select('id')
            .eq('userId', userId)
            .eq('prizeId', prizeId)
            .eq('status', 'pending')
            .maybeSingle();
        if (existingRedemption) {
            return { success: false, error: 'You already have a pending redemption for this prize' };
        }

        const prize = await prizeDb.findById(prizeId);
        if (!prize || !prize.isActive || prize.status !== 'published') {
            return { success: false, error: 'This prize is no longer available' };
        }

        const { data: rpc, error: rpcError } = await supabase.rpc('redeem_prize', {
            p_user_id: userId,
            p_prize_id: prizeId,
            p_full_name: fullName,
            p_whatsapp_number: whatsappNumber,
            p_address: address,
        });
        if (rpcError || !rpc?.success) {
            const msg = rpc?.error === 'Insufficient points'
                ? `Insufficient points. You need ${rpc.required} points but have ${rpc.available}`
                : (rpc?.error as string) || 'Failed to process redemption';
            return { success: false, error: msg };
        }

        revalidatePath('/prizes');
        revalidatePath('/profile');

        return {
            success: true,
            data: {
                id: rpc.redemption_id,
                userId,
                prizeId,
                pointsUsed: rpc.points_used,
                status: 'pending',
                prize: { name: prize.name, imageUrl: prize.imageUrl },
            },
        };
    } catch (error) {
        console.error('Error redeeming prize:', error);
        return { success: false, error: 'Failed to process redemption' };
    }
}

// ============ ADMIN ACTIONS ============

/**
 * Get all prizes for admin view (including drafts and inactive)
 */
export async function getAllPrizesAdmin(
    filters?: {
        category?: PrizeCategory;
        status?: PrizeStatus | 'all';
        showInactive?: boolean;
        search?: string;
    }
): Promise<{ success: boolean; data?: Prize[]; error?: string }> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        const supabase = getAdminDb();

        let query = supabase.from('Prize').select('*');

        if (filters?.category && filters.category !== 'all') {
            query = query.eq('category', filters.category);
        }

        if (filters?.status && filters.status !== 'all') {
            query = query.eq('status', filters.status);
        }

        if (filters?.search) {
            query = query.or(`name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
        }

        query = query.order('createdAt', { ascending: false });

        const { data: prizes, error } = await query;

        if (error) throw error;

        // Get counts for each prize
        const prizesWithCounts = await Promise.all(
            (prizes || []).map(async (prize) => {
                const [redemptionsResult, winningsResult] = await Promise.all([
                    supabase.from('PrizeRedemption').select('*', { count: 'exact', head: true }).eq('prizeId', prize.id),
                    supabase.from('Winning').select('*', { count: 'exact', head: true }).eq('prizeId', prize.id),
                ]);

                return {
                    ...prize,
                    _count: {
                        redemptions: redemptionsResult.count || 0,
                        winnings: winningsResult.count || 0,
                    },
                };
            })
        );

        return { success: true, data: prizesWithCounts as unknown as Prize[] };
    } catch (error) {
        console.error('Error fetching admin prizes:', error);
        return { success: false, error: 'Failed to fetch prizes' };
    }
}

/**
 * Get a single prize by ID
 */
export async function getPrizeById(
    id: string
): Promise<{ success: boolean; data?: Prize; error?: string }> {
    try {
        const supabase = await getDb();
        const prize = await prizeDb.findById(id);

        if (!prize) {
            return { success: false, error: 'Prize not found' };
        }

        // Get counts
        const [redemptionsResult, winningsResult] = await Promise.all([
            supabase.from('PrizeRedemption').select('*', { count: 'exact', head: true }).eq('prizeId', id),
            supabase.from('Winning').select('*', { count: 'exact', head: true }).eq('prizeId', id),
        ]);

        const prizeWithCounts = {
            ...prize,
            _count: {
                redemptions: redemptionsResult.count || 0,
                winnings: winningsResult.count || 0,
            },
        };

        return { success: true, data: prizeWithCounts as unknown as Prize };
    } catch (error) {
        console.error('Error fetching prize:', error);
        return { success: false, error: 'Failed to fetch prize' };
    }
}

/**
 * Create a new prize (admin only)
 */
export async function createPrize(
    formData: PrizeFormData
): Promise<{ success: boolean; data?: Prize; error?: string }> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        // Validate input
        const validation = prizeSchema.safeParse(formData);
        if (!validation.success) {
            return {
                success: false,
                error: validation.error.issues[0]?.message || 'Invalid input'
            };
        }

        const prize = await prizeDb.create({
            name: validation.data.name,
            description: validation.data.description || null,
            imageUrl: validation.data.imageUrl || null,
            modelUrl: validation.data.modelUrl || null,
            type: validation.data.type,
            pointsRequired: validation.data.pointsRequired,
            category: validation.data.category,
            stock: validation.data.stock,
            status: validation.data.status,
            value: validation.data.value,
            isActive: true,
        });

        revalidatePath('/prizes');
        revalidatePath('/admin/prizes');

        return { success: true, data: prize as unknown as Prize };
    } catch (error) {
        console.error('Error creating prize:', error);
        return { success: false, error: 'Failed to create prize' };
    }
}

/**
 * Update an existing prize (admin only)
 */
export async function updatePrize(
    id: string,
    formData: Partial<PrizeFormData>
): Promise<{ success: boolean; data?: Prize; error?: string }> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        // Check if prize exists
        const existing = await prizeDb.findById(id);
        if (!existing) {
            return { success: false, error: 'Prize not found' };
        }

        // Partial validation
        const partialSchema = prizeSchema.partial();
        const validation = partialSchema.safeParse(formData);
        if (!validation.success) {
            return {
                success: false,
                error: validation.error.issues[0]?.message || 'Invalid input'
            };
        }

        const updateData: Record<string, unknown> = {};

        if (validation.data.name) updateData.name = validation.data.name;
        if (validation.data.description !== undefined) updateData.description = validation.data.description || null;
        if (validation.data.imageUrl !== undefined) updateData.imageUrl = validation.data.imageUrl || null;
        if (validation.data.modelUrl !== undefined) updateData.modelUrl = validation.data.modelUrl || null;
        if (validation.data.type) updateData.type = validation.data.type;
        if (validation.data.pointsRequired !== undefined) updateData.pointsRequired = validation.data.pointsRequired;
        if (validation.data.category) updateData.category = validation.data.category;
        if (validation.data.stock !== undefined) updateData.stock = validation.data.stock;
        if (validation.data.status) updateData.status = validation.data.status;
        if (validation.data.value !== undefined) updateData.value = validation.data.value;

        const prize = await prizeDb.update(id, updateData);

        revalidatePath('/prizes');
        revalidatePath('/admin/prizes');

        return { success: true, data: prize as unknown as Prize };
    } catch (error) {
        console.error('Error updating prize:', error);
        return { success: false, error: 'Failed to update prize' };
    }
}

/**
 * Delete a prize (admin only)
 */
export async function deletePrize(
    id: string
): Promise<{ success: boolean; error?: string }> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        const supabase = await getDb();

        // Check if prize has redemptions
        const { count: redemptionCount } = await supabase
            .from('PrizeRedemption')
            .select('*', { count: 'exact', head: true })
            .eq('prizeId', id);

        if (redemptionCount && redemptionCount > 0) {
            return {
                success: false,
                error: `Cannot delete prize with ${redemptionCount} redemptions. Deactivate instead.`
            };
        }

        // Use prizeDb.delete which uses admin client to bypass RLS
        await prizeDb.delete(id);

        revalidatePath('/prizes');
        revalidatePath('/admin/prizes');

        return { success: true };
    } catch (error) {
        console.error('Error deleting prize:', error);
        return { success: false, error: 'Failed to delete prize' };
    }
}

/**
 * Toggle prize status (draft/published)
 */
export async function togglePrizeStatus(
    id: string
): Promise<{ success: boolean; data?: Prize; error?: string }> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        const prize = await prizeDb.findById(id);
        if (!prize) {
            return { success: false, error: 'Prize not found' };
        }

        const newStatus = prize.status === 'published' ? 'draft' : 'published';

        const updated = await prizeDb.update(id, { status: newStatus });

        revalidatePath('/prizes');
        revalidatePath('/admin/prizes');

        return { success: true, data: updated as unknown as Prize };
    } catch (error) {
        console.error('Error toggling prize status:', error);
        return { success: false, error: 'Failed to toggle prize status' };
    }
}

/**
 * Toggle prize active state
 */
export async function togglePrizeActive(
    id: string
): Promise<{ success: boolean; data?: Prize; error?: string }> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        const prize = await prizeDb.findById(id);
        if (!prize) {
            return { success: false, error: 'Prize not found' };
        }

        const updated = await prizeDb.update(id, { isActive: !prize.isActive });

        revalidatePath('/prizes');
        revalidatePath('/admin/prizes');

        return { success: true, data: updated as unknown as Prize };
    } catch (error) {
        console.error('Error toggling prize active state:', error);
        return { success: false, error: 'Failed to toggle prize active state' };
    }
}
