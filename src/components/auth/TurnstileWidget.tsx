'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import {
    CLOCK_SKEW_LIMIT_MS,
    measureClockSkew,
    turnstileMessage,
    turnstileProblem,
    type TurnstileProblem,
} from '@/lib/network-errors';

// The site key is public; its secret lives only in Supabase's CAPTCHA settings, and Supabase checks
// every token itself. The fallback is the production widget, so a build without the variable still
// shows a working check on 1think2win.com and localhost.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '0x4AAAAAAFYus6FWoa1eqnrG';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileOptions {
    sitekey: string;
    action: string;
    theme: 'dark';
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': (code?: string) => void;
}

interface TurnstileApi {
    render(container: HTMLElement, options: TurnstileOptions): string;
    reset(widgetId: string): void;
    remove(widgetId: string): void;
}

declare global {
    interface Window {
        turnstile?: TurnstileApi;
    }
}

let scriptLoad: Promise<TurnstileApi> | null = null;

// Loads Turnstile once per page. A failed load is forgotten, so the next widget to mount tries again.
function loadTurnstile(): Promise<TurnstileApi> {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    scriptLoad ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = SCRIPT_URL;
        script.async = true;
        script.onload = () => resolve(window.turnstile!);
        script.onerror = () => {
            scriptLoad = null;
            script.remove();
            reject(new Error('Turnstile failed to load'));
        };
        document.head.appendChild(script);
    });
    return scriptLoad;
}

export interface TurnstileHandle {
    /** Starts a fresh check: a token works for one request, so call this after every submit */
    reset(): void;
}

interface TurnstileWidgetProps {
    /** Labels the check in Cloudflare's analytics, e.g. "login" */
    action: string;
    /** Called with a token once the check passes, and with null when it expires, fails or is reset */
    onToken(token: string | null): void;
}

interface Problem {
    kind: TurnstileProblem;
    skewMs: number | null;
}

const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(function TurnstileWidget(
    { action, onToken },
    ref
) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    // The latest callback, without re-rendering the widget when the parent passes a new one
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;
    const [problem, setProblem] = useState<Problem | null>(null);
    // Bumped by "Try again": removes the widget and renders a new one (reloading the script if needed)
    const [attempt, setAttempt] = useState(0);

    const retry = useCallback(() => {
        setProblem(null);
        onTokenRef.current(null);
        setAttempt((n) => n + 1);
    }, []);

    useImperativeHandle(ref, () => ({
        reset() {
            // The form may have unmounted while its request was in flight
            if (widgetIdRef.current) window.turnstile!.reset(widgetIdRef.current);
            onTokenRef.current(null);
        },
    }), []);

    useEffect(() => {
        let cancelled = false;

        const fail = (kind: TurnstileProblem, code?: string) => {
            onTokenRef.current(null);
            if (!navigator.onLine) {
                setProblem({ kind: 'offline', skewMs: null });
                return;
            }
            setProblem({ kind, skewMs: null });
            if (kind === 'config') {
                // A broken site key locks everyone out of signing in: make sure we hear about it
                Sentry.captureMessage(`Turnstile configuration error ${code}`, { level: 'error', tags: { turnstile: code } });
                return;
            }
            // Whatever the code, a clock far off the real time is the thing to fix first
            void measureClockSkew().then((skewMs) => {
                if (cancelled || skewMs === null || Math.abs(skewMs) <= CLOCK_SKEW_LIMIT_MS) return;
                // Only while the check is still failing: a pass in the meantime cleared the problem
                setProblem((current) => (current ? { kind: 'clock', skewMs } : current));
            });
        };

        loadTurnstile().then(
            (turnstile) => {
                if (cancelled) return;
                widgetIdRef.current = turnstile.render(containerRef.current!, {
                    sitekey: SITE_KEY,
                    action,
                    theme: 'dark',
                    callback: (token) => {
                        setProblem(null);
                        onTokenRef.current(token);
                    },
                    'expired-callback': () => onTokenRef.current(null),
                    'error-callback': (code) => fail(turnstileProblem(code), code),
                });
            },
            () => {
                if (!cancelled) fail('blocked');
            }
        );
        return () => {
            cancelled = true;
            if (widgetIdRef.current) {
                window.turnstile!.remove(widgetIdRef.current);
                widgetIdRef.current = null;
            }
        };
    }, [action, attempt]);

    // Offline: start again by itself as soon as the connection is back
    const offline = problem?.kind === 'offline';
    useEffect(() => {
        if (!offline) return;
        window.addEventListener('online', retry);
        return () => window.removeEventListener('online', retry);
    }, [offline, retry]);

    return (
        <div>
            <div ref={containerRef} className="flex justify-center min-h-[65px]" data-testid="turnstile" />
            {problem && (
                <div role="alert" className="mt-2 text-sm text-red-400 text-center">
                    <p>{turnstileMessage(problem.kind, problem.skewMs)}</p>
                    {!offline && (
                        <button
                            type="button"
                            onClick={retry}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-400/40 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/10 transition-colors"
                        >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                            Try again
                        </button>
                    )}
                </div>
            )}
        </div>
    );
});

export default TurnstileWidget;
