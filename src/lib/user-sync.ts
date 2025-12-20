import prisma from './prisma';

/**
 * Ensure user exists in Prisma database
 * This prevents foreign key errors when the user hasn't been synced from Supabase
 */
export async function ensureUserExists(userId: string, email?: string | null): Promise<boolean> {
    try {
        // Check if user exists by ID
        const existingUserById = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (existingUserById) {
            return true;
        }

        // Check if user exists by email (might have a different ID)
        if (email) {
            const existingUserByEmail = await prisma.user.findUnique({
                where: { email },
            });

            if (existingUserByEmail) {
                // User exists with this email but different ID
                // For ensureUserExists, we'll just return true and let the caller use this user
                // The full migration should be handled by sync-user endpoint
                console.log(`User with email ${email} exists with different ID: ${existingUserByEmail.id}`);
                return true;
            }
        }

        // User doesn't exist, create them
        await prisma.user.create({
            data: {
                id: userId,
                email: email || `user_${userId}@placeholder.local`,
                name: email?.split('@')[0] || null,
            },
        });
        console.log(`User ${userId} created in database`);

        return true;
    } catch (error) {
        console.error('Error ensuring user exists:', error);
        // If error is due to unique constraint (race condition), user exists
        if (error instanceof Error && error.message.includes('Unique constraint')) {
            return true;
        }
        // Check for Prisma unique constraint error code
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
            return true;
        }
        return false;
    }
}

/**
 * Sync user from Supabase to Prisma database
 * This updates an existing user or creates a new one
 */
export async function syncUser(
    userId: string,
    email: string,
    name?: string | null,
    phone?: string | null,
    dateOfBirth?: Date | null
): Promise<{ success: boolean; user?: { id: string; email: string } }> {
    try {
        const user = await prisma.user.upsert({
            where: { id: userId },
            update: {
                email,
                name: name || null,
                phone: phone || null,
                dateOfBirth: dateOfBirth || null,
                updatedAt: new Date(),
            },
            create: {
                id: userId,
                email,
                name: name || null,
                phone: phone || null,
                dateOfBirth: dateOfBirth || null,
            },
        });

        return { success: true, user: { id: user.id, email: user.email } };
    } catch (error) {
        console.error('Error syncing user:', error);
        return { success: false };
    }
}
