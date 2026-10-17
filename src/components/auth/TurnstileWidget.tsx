'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

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
    'error-callback': () => void;
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

const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(function TurnstileWidget(
    { action, onToken },
    ref
) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    // The latest callback, without re-rendering the widget when the parent passes a new one
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;
    const [failed, setFailed] = useState(false);

    useImperativeHandle(ref, () => ({
        reset() {
            // The form may have unmounted while its request was in flight
            if (widgetIdRef.current) window.turnstile!.reset(widgetIdRef.current);
            onTokenRef.current(null);
        },
    }), []);

    useEffect(() => {
        let cancelled = false;
        loadTurnstile().then(
            (turnstile) => {
                if (cancelled) return;
                widgetIdRef.current = turnstile.render(containerRef.current!, {
                    sitekey: SITE_KEY,
                    action,
                    theme: 'dark',
                    callback: (token) => {
                        setFailed(false);
                        onTokenRef.current(token);
                    },
                    'expired-callback': () => onTokenRef.current(null),
                    'error-callback': () => {
                        setFailed(true);
                        onTokenRef.current(null);
                    },
                });
            },
            () => {
                if (!cancelled) setFailed(true);
            }
        );
        return () => {
            cancelled = true;
            if (widgetIdRef.current) {
                window.turnstile!.remove(widgetIdRef.current);
                widgetIdRef.current = null;
            }
        };
    }, [action]);

    return (
        <div>
            <div ref={containerRef} className="flex justify-center min-h-[65px]" data-testid="turnstile" />
            {failed && (
                <p role="alert" className="mt-2 text-sm text-red-400 text-center">
                    The security check couldn&apos;t finish. Check your connection or ad blocker, then reload the page.
                </p>
            )}
        </div>
    );
});

export default TurnstileWidget;
