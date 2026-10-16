'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import type { AuthDetection } from '@/lib/auth-detection';

function GoogleLogo({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
    );
}

/**
 * Shows how the person is signed in right now, detected from the session (not from how the account
 * was first created):
 *   Google session            -> "Verified Google sign-in"
 *   Email + password session  -> "Email & password"
 *   Signed in from an emailed link -> "Email link sign-in"
 * plus a small note when the account has both ("Password also set" / "Google linked").
 */
export default function SignInMethodBadge() {
    const [info, setInfo] = useState<AuthDetection | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/profile/auth-method', { credentials: 'include', cache: 'no-store' });
                if (!res.ok) return;
                const data = (await res.json()) as AuthDetection;
                if (!cancelled) setInfo(data);
            } catch {
                // Cosmetic only: show nothing if detection is unavailable
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (!info) {
        return <span className="inline-block h-6 w-36 rounded-full bg-white/5 animate-pulse self-center lg:self-auto" aria-hidden="true" />;
    }

    const linkedGoogle = info.linkedProviders.includes('google');
    const note =
        info.currentMethod === 'google' && info.hasPassword
            ? 'Password also set'
            : info.currentMethod === 'password' && linkedGoogle
              ? 'Google linked'
              : null;

    const tone =
        info.currentMethod === 'google'
            ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-100'
            : info.currentMethod === 'password'
              ? 'bg-indigo-500/15 border-indigo-400/30 text-indigo-100'
              : 'bg-slate-500/15 border-slate-400/30 text-slate-200';

    return (
        <span className="inline-flex items-center gap-2 self-center lg:self-auto">
            <span
                data-testid="signin-method"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${tone}`}
                aria-label={note ? `${info.label}. ${note}` : info.label}
            >
                {info.currentMethod === 'google' ? (
                    info.verifiedGoogle ? (
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                    ) : (
                        <GoogleLogo className="w-3.5 h-3.5" />
                    )
                ) : info.currentMethod === 'password' ? (
                    <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                    <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                {info.currentMethod === 'google' && info.verifiedGoogle && <GoogleLogo className="w-3.5 h-3.5" />}
                {info.label}
            </span>
            {note && <span className="text-xs text-slate-400">{note}</span>}
        </span>
    );
}
