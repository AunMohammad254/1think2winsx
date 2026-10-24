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

/** What an admin action returns without an admin session. */
export const ADMIN_REQUIRED = { success: false as const, error: 'Unauthorized: admin session required' };

/** Non-throwing variant: returns `null` when authorised, or an error result to return. */
export async function adminActionGuard(): Promise<{ success: false; error: string } | null> {
    return (await adminActionEmail()) ? null : { ...ADMIN_REQUIRED };
}

/** For actions that record who acted (lib/admin-action-log): the admin's email, or null without a session. */
export async function adminActionEmail(): Promise<string | null> {
    try {
        return await assertAdmin();
    } catch {
        return null;
    }
}
