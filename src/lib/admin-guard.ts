import { validateAdminSession } from './admin-session';

/**
 * Guard for admin-only Server Actions.
 *
 * Server Actions are public HTTP endpoints: anyone who can read an admin page's
 * JS chunk can invoke them directly. Every admin action MUST call this first.
 *
 * Returns an error result (instead of throwing/redirecting) so callers can
 * `return` it directly from actions that use the `{ success, error }` shape.
 */
export class AdminAuthError extends Error {
    constructor() {
        super('Admin authentication required');
        this.name = 'AdminAuthError';
    }
}

/** Throws AdminAuthError when there is no valid admin session. Returns the admin email. */
export async function assertAdmin(): Promise<string> {
    const session = await validateAdminSession();
    if (!session.valid || !session.email) {
        throw new AdminAuthError();
    }
    return session.email;
}

/** Non-throwing variant: returns `null` when authorised, or an error result to return. */
export async function adminActionGuard(): Promise<{ success: false; error: string } | null> {
    try {
        await assertAdmin();
        return null;
    } catch {
        return { success: false, error: 'Unauthorized: admin session required' };
    }
}
