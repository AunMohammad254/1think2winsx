/**
 * DB LOAD BALANCER COMPATIBILITY SHIM
 * 
 * This file redirects db-load-balancer imports to Supabase.
 * 
 * @deprecated Use imports from '@/lib/supabase/db' instead
 */

import { getDb } from '@/lib/supabase/db';

// Create a mock enhanced prisma that redirects to Supabase
export const enhancedPrisma = {
    async getClient() {
        return getDb();
    },
    async transaction<T>(
        operation: (client: Awaited<ReturnType<typeof getDb>>) => Promise<T>,
        options?: { timeout?: number }
    ): Promise<T> {
        const client = await getDb();
        return operation(client);
    },
    async healthCheck() {
        try {
            const client = await getDb();
            await client.from('User').select('id').limit(1);
            return { status: 'healthy', latency: 0 };
        } catch (error) {
            return { status: 'unhealthy', error: (error as Error).message };
        }
    }
};

export default enhancedPrisma;
