import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { detectForUser } from '@/lib/auth-detection-server';

/**
 * GET /api/profile/auth-method
 *
 * Tells the profile how the current session signed in (Google, email + password, email link) and what
 * the account can do (has a password? which providers are linked?).
 *
 * The user comes from getUser() (checked with Supabase, always fresh, so a password set a moment ago
 * is reflected). The sign-in method comes from the session token's `amr` claim.
 */
export async function GET() {
    try {
        const supabase = await createClient();

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const detection = await detectForUser(supabase, user);

        return NextResponse.json(detection, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error('Error detecting sign-in method:', error);
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
}
