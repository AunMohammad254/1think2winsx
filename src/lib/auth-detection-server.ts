import type { User } from '@supabase/supabase-js';
import { decodeAmr, detectAuth, type AuthDetection } from './auth-detection';
import { userHasPassword } from './password-status';
import { markPasswordSet } from './password-flag';

interface SessionReader {
    auth: { getSession: () => Promise<{ data: { session: { access_token?: string } | null } }> };
}

/**
 * Detect how the current session signed in and what the account can do (server side).
 *
 * Self-healing: a session that signed in WITH A PASSWORD proves the account has one. If the account
 * isn't marked yet (e.g. a Google account that set its password before the has_password flag
 * existed), record it now, so the profile offers "Change a Password" from then on.
 */
export async function detectForUser(supabase: SessionReader, user: User): Promise<AuthDetection> {
    const { data: { session } } = await supabase.auth.getSession();
    const detection = detectAuth(user, decodeAmr(session?.access_token));

    if (detection.currentMethod === 'password' && !userHasPassword(user)) {
        await markPasswordSet(user.id);
    }
    return detection;
}
