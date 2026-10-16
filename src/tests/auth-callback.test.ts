import { describe, it, expect, vi, beforeEach } from 'vitest';

const exchangeCodeForSession = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from '@/app/auth/callback/route';

const call = (query: string) => GET(new Request(`http://localhost:3000/auth/callback?${query}`));
const location = (res: Response) => res.headers.get('location');

beforeEach(() => {
    vi.clearAllMocks();
    exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe('/auth/callback', () => {
    it('signs the person in and sends them to the set-password page', async () => {
        const res = await call('code=abc&next=/update-password');
        expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
        expect(location(res)).toBe('http://localhost:3000/update-password');
    });

    it('defaults to /quizzes when no next is given', async () => {
        const res = await call('code=abc');
        expect(location(res)).toBe('http://localhost:3000/quizzes');
    });

    describe('when a password setup/reset link no longer works', () => {
        it('explains it on the forgot-password page instead of silently showing the login form (code exchange fails)', async () => {
            exchangeCodeForSession.mockResolvedValue({ error: { message: 'flow state not found' } });
            const res = await call('code=abc&next=/update-password');
            expect(location(res)).toBe('http://localhost:3000/forgot-password?error=link_expired');
        });

        it('handles Supabase reporting a spent link ("One-time token not found" → otp_expired)', async () => {
            const res = await call(
                'next=/update-password&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
            );
            expect(exchangeCodeForSession).not.toHaveBeenCalled();
            expect(location(res)).toBe('http://localhost:3000/forgot-password?error=link_expired');
        });

        it('handles a link with no code at all', async () => {
            const res = await call('next=/update-password');
            expect(location(res)).toBe('http://localhost:3000/forgot-password?error=link_expired');
        });

        it('does not exchange a code when Supabase also reported an error', async () => {
            await call('code=abc&next=/update-password&error_code=otp_expired');
            expect(exchangeCodeForSession).not.toHaveBeenCalled();
        });
    });

    it('shows other failed sign-in links on the login page, with the error preserved in the URL', async () => {
        exchangeCodeForSession.mockResolvedValue({ error: { message: 'bad' } });
        const res = await call('code=abc&next=/quizzes');
        expect(location(res)).toBe('http://localhost:3000/auth?mode=login&error=auth_callback_error');
    });

    it('still blocks open redirects through next', async () => {
        for (const evil of ['//evil.com', '@evil.com', '/\\evil.com', 'https://evil.com']) {
            const res = await call(`code=abc&next=${encodeURIComponent(evil)}`);
            expect(location(res)).toBe('http://localhost:3000/quizzes');
        }
    });
});
