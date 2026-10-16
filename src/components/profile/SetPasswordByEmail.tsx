'use client';

import { useState } from 'react';
import { Mail, Loader2, Check, AlertCircle } from 'lucide-react';
import { requestPasswordSetupEmail } from '@/actions/password-setup-actions';

interface SetPasswordByEmailProps {
    /** Display name(s) of the sign-in provider, e.g. "Google" */
    providerLabel: string;
    /** The account already has a password (they signed in with Google, so we can't ask for the current one) */
    hasPassword?: boolean;
}

/**
 * Shown to people whose account was created with Google (so it has no password yet).
 * One button emails them a link to set one; the link signs them in and lands on /update-password.
 * Used by both the change-password dialog and the /profile/change-password page.
 */
export default function SetPasswordByEmail({ providerLabel, hasPassword = false }: SetPasswordByEmailProps) {
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleSend = async () => {
        setStatus('sending');
        setError(null);
        try {
            const result = await requestPasswordSetupEmail();
            if (result.error) {
                setError(result.error);
                setStatus('idle');
            } else {
                setEmail(result.email || '');
                setStatus('sent');
            }
        } catch {
            setError('An error occurred. Please try again.');
            setStatus('idle');
        }
    };

    return (
        <div className="text-center py-6" aria-live="polite">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 flex items-center justify-center border border-blue-500/30">
                <Mail className="w-8 h-8 text-blue-300" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">
                {hasPassword ? 'Choose a new password' : 'Sign in with a password too'}
            </h3>
            <p className="text-slate-300 text-sm mb-5">
                {hasPassword ? (
                    <>
                        You&apos;re signed in with <span className="font-semibold text-blue-300">{providerLabel}</span>, so we
                        can&apos;t check your current password. We&apos;ll email you a link to set a new one.
                    </>
                ) : (
                    <>
                        Your account uses <span className="font-semibold text-blue-300">{providerLabel}</span> sign-in. Add a
                        password to also sign in with your email and password.
                    </>
                )}
            </p>

            {status === 'sent' ? (
                <div className="bg-green-500/10 border border-green-500/20 text-green-100 px-4 py-3 rounded-xl text-sm text-left">
                    <div className="flex items-start">
                        <Check className="w-5 h-5 mr-3 mt-0.5 text-green-300 flex-shrink-0" aria-hidden="true" />
                        <span>
                            We sent a link to <span className="font-mono">{email}</span>. Open it (check spam too) to
                            choose your password.
                        </span>
                    </div>
                </div>
            ) : (
                <>
                    <button
                        type="button"
                        onClick={handleSend}
                        disabled={status === 'sending'}
                        className="inline-flex items-center justify-center px-5 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        {status === 'sending' ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Mail className="w-4 h-4 mr-2" aria-hidden="true" />
                                Email me a link to set up a password
                            </>
                        )}
                    </button>
                    {error && (
                        <p className="mt-3 text-sm text-red-300 flex items-start justify-center text-left">
                            <AlertCircle className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0" aria-hidden="true" />
                            {error}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
