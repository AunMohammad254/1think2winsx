'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import AppErrorView from '@/components/errors/AppErrorView';

/** Crash page for every page without its own error.tsx; the navbar and footer stay on screen. */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
    useEffect(() => {
        // This page caught the error, so Sentry's global handler never sees it: report it here
        Sentry.captureException(error, { tags: { page: 'root' } });
    }, [error]);

    return <AppErrorView error={error} retry={retry} />;
}
