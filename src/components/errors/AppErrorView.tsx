'use client';

import Link from 'next/link';
import { AlertTriangle, Home, RefreshCw, WifiOff } from 'lucide-react';
import ErrorCard, { primaryActionClass, secondaryActionClass } from './ErrorCard';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { classifyPageError } from '@/lib/network-errors';

const COPY = {
    offline: {
        icon: <WifiOff className="w-10 h-10" />,
        title: 'No internet connection',
        message: 'Check your Wi-Fi or mobile data, then try again.',
    },
    update: {
        icon: <RefreshCw className="w-10 h-10" />,
        title: 'A new version is available',
        message: '1Think 2Win was just updated. Reload the page to continue.',
    },
    generic: {
        icon: <AlertTriangle className="w-10 h-10 text-red-400" />,
        title: 'Something went wrong',
        message: "This page hit an unexpected problem. Try again, or head back home.",
    },
};

/** The crash page for any part of the site without its own error page. */
export default function AppErrorView({ error, retry }: { error: unknown; retry: () => void }) {
    const kind = classifyPageError(error, useOnlineStatus());
    const copy = COPY[kind];
    const digest = (error as { digest?: string } | null)?.digest;

    return (
        <ErrorCard icon={copy.icon} title={copy.title} message={copy.message} digest={digest}>
            <button
                type="button"
                // A file from an old deploy is gone for good: only a full reload fetches the new ones
                onClick={kind === 'update' ? () => window.location.reload() : retry}
                className={primaryActionClass}
            >
                <RefreshCw className="w-5 h-5" />
                {kind === 'update' ? 'Reload page' : 'Try again'}
            </button>
            <Link href="/" className={secondaryActionClass}>
                <Home className="w-5 h-5" />
                Go Home
            </Link>
        </ErrorCard>
    );
}
