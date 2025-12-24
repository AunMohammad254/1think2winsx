'use server';

import prisma from '@/lib/prisma';
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
        // Build where clause
        const where: Record<string, unknown> = {
            isActive: true,
            status: 'published',
        };

        if (category !== 'all') {
            where.category = category;
        }

        // Build orderBy clause
        let orderBy: Record<string, 'asc' | 'desc'> = { pointsRequired: 'asc' };
        switch (sortBy) {
            case 'points-desc':
                orderBy = { pointsRequired: 'desc' };
                break;
            case 'newest':
                orderBy = { createdAt: 'desc' };
                break;
            case 'oldest':
                orderBy = { createdAt: 'asc' };
                break;
            case 'name-asc':
                orderBy = { name: 'asc' };
                break;
            default:
                orderBy = { pointsRequired: 'asc' };
        }

        const prizes = await prisma.prize.findMany({
            where,
            orderBy,
            select: {
                id: true,
                name: true,
                description: true,
                imageUrl: true,
                modelUrl: true,
                type: true,
                pointsRequired: true,
                isActive: true,
                category: true,
                stock: true,
                status: true,
                value: true,
                createdAt: true,
                updatedAt: true,
            },
        });

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
    userId: string,
    formData: {
        prizeId: string;
        fullName: string;
        whatsappNumber: string;
        address: string;
    }
): Promise<{ success: boolean; data?: unknown; error?: string }> {
    try {
        // Validate input
        const validation = redemptionSchema.safeParse(formData);
        if (!validation.success) {
            return {
                success: false,
                error: validation.error.errors[0]?.message || 'Invalid input'
            };
        }

        const { prizeId, fullName, whatsappNumber, address } = validation.data;

        // Get user and prize in parallel
        const [user, prize] = await Promise.all([
            prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, points: true, email: true },
            }),
            prisma.prize.findUnique({
                where: { id: prizeId },
                select: {
                    id: true,
                    name: true,
                    pointsRequired: true,
                    isActive: true,
                    status: true,
                    stock: true,
                },
            }),
        ]);

        if (!user) {
            return { success: false, error: 'User not found' };
        }

        if (!prize) {
            return { success: false, error: 'Prize not found' };
        }

        if (!prize.isActive || prize.status !== 'published') {
            return { success: false, error: 'This prize is no longer available' };
        }

        if (prize.stock !== null && prize.stock <= 0) {
            return { success: false, error: 'This prize is out of stock' };
        }

        if (user.points < prize.pointsRequired) {
            return {
                success: false,
                error: `Insufficient points. You need ${prize.pointsRequired} points but have ${user.points}`
            };
        }

        // Check for existing pending redemption
        const existingRedemption = await prisma.prizeRedemption.findFirst({
            where: {
                userId,
                prizeId,
                status: 'pending',
            },
        });

        if (existingRedemption) {
            return {
                success: false,
                error: 'You already have a pending redemption for this prize'
            };
        }

        // Create redemption and deduct points in a transaction
        const redemption = await prisma.$transaction(async (tx) => {
            // Deduct points
            await tx.user.update({
                where: { id: userId },
                data: {
                    points: { decrement: prize.pointsRequired },
                },
            });

            // Decrease stock if applicable
            if (prize.stock !== null && prize.stock > 0) {
                await tx.prize.update({
                    where: { id: prizeId },
                    data: {
                        stock: { decrement: 1 },
                    },
                });
            }

            // Create redemption record
            return await tx.prizeRedemption.create({
                data: {
                    userId,
                    prizeId,
                    pointsUsed: prize.pointsRequired,
                    status: 'pending',
                    fullName,
                    whatsappNumber,
                    address,
                },
                include: {
                    prize: {
                        select: {
                            name: true,
                            imageUrl: true,
                        },
                    },
                },
            });
        });

        revalidatePath('/prizes');
        revalidatePath('/profile');

        return {
            success: true,
            data: redemption,
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
    try {
        const where: Record<string, unknown> = {};

        if (filters?.category && filters.category !== 'all') {
            where.category = filters.category;
        }

        if (filters?.status && filters.status !== 'all') {
            where.status = filters.status;
        }

        if (!filters?.showInactive) {
            // Don't filter by isActive by default in admin
        }

        if (filters?.search) {
            where.OR = [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { description: { contains: filters.search, mode: 'insensitive' } },
            ];
        }

        const prizes = await prisma.prize.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: {
                        redemptions: true,
                        winnings: true,
                    },
                },
            },
        });

        return { success: true, data: prizes as unknown as Prize[] };
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
        const prize = await prisma.prize.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        redemptions: true,
                        winnings: true,
                    },
                },
            },
        });

        if (!prize) {
            return { success: false, error: 'Prize not found' };
        }

        return { success: true, data: prize as unknown as Prize };
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
    try {
        // Validate input
        const validation = prizeSchema.safeParse(formData);
        if (!validation.success) {
            return {
                success: false,
                error: validation.error.errors[0]?.message || 'Invalid input'
            };
        }

        const prize = await prisma.prize.create({
            data: {
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
            },
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
    try {
        // Check if prize exists
        const existing = await prisma.prize.findUnique({ where: { id } });
        if (!existing) {
            return { success: false, error: 'Prize not found' };
        }

        // Partial validation
        const partialSchema = prizeSchema.partial();
        const validation = partialSchema.safeParse(formData);
        if (!validation.success) {
            return {
                success: false,
                error: validation.error.errors[0]?.message || 'Invalid input'
            };
        }

        const prize = await prisma.prize.update({
            where: { id },
            data: {
                ...(validation.data.name && { name: validation.data.name }),
                ...(validation.data.description !== undefined && { description: validation.data.description || null }),
                ...(validation.data.imageUrl !== undefined && { imageUrl: validation.data.imageUrl || null }),
                ...(validation.data.modelUrl !== undefined && { modelUrl: validation.data.modelUrl || null }),
                ...(validation.data.type && { type: validation.data.type }),
                ...(validation.data.pointsRequired !== undefined && { pointsRequired: validation.data.pointsRequired }),
                ...(validation.data.category && { category: validation.data.category }),
                ...(validation.data.stock !== undefined && { stock: validation.data.stock }),
                ...(validation.data.status && { status: validation.data.status }),
                ...(validation.data.value !== undefined && { value: validation.data.value }),
            },
        });

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
    try {
        // Check if prize has redemptions
        const prize = await prisma.prize.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        redemptions: true,
                    },
                },
            },
        });

        if (!prize) {
            return { success: false, error: 'Prize not found' };
        }

        if (prize._count.redemptions > 0) {
            return {
                success: false,
                error: `Cannot delete prize with ${prize._count.redemptions} redemptions. Deactivate instead.`
            };
        }

        await prisma.prize.delete({ where: { id } });

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
    try {
        const prize = await prisma.prize.findUnique({ where: { id } });
        if (!prize) {
            return { success: false, error: 'Prize not found' };
        }

        const newStatus = prize.status === 'published' ? 'draft' : 'published';

        const updated = await prisma.prize.update({
            where: { id },
            data: { status: newStatus },
        });

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
    try {
        const prize = await prisma.prize.findUnique({ where: { id } });
        if (!prize) {
            return { success: false, error: 'Prize not found' };
        }

        const updated = await prisma.prize.update({
            where: { id },
            data: { isActive: !prize.isActive },
        });

        revalidatePath('/prizes');
        revalidatePath('/admin/prizes');

        return { success: true, data: updated as unknown as Prize };
    } catch (error) {
        console.error('Error toggling prize active state:', error);
        return { success: false, error: 'Failed to toggle prize active state' };
    }
}
