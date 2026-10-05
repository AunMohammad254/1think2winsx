import { HAS_PASSWORD_FLAG } from './password-status';

/**
 * Records, in the account's server-only `app_metadata`, that it now has a password.
 *
 * Needed because Supabase does not add an "email" identity when an OAuth account sets a password, so
 * nothing else tells the app that "Change password" (not "Set a password") is the right choice.
 * Failing to save this must never fail the password change itself, so errors are logged and swallowed.
 */
export async function markPasswordSet(userId: string): Promise<boolean> {
    try {
        const { getAdminDb } = await import('./supabase/db-modules/shared');
        const { error } = await getAdminDb().auth.admin.updateUserById(userId, {
            app_metadata: { [HAS_PASSWORD_FLAG]: true },
        });
        if (error) {
            console.error('markPasswordSet failed:', error.message);
            return false;
        }
        return true;
    } catch (err) {
        console.error('markPasswordSet failed:', err);
        return false;
    }
}
