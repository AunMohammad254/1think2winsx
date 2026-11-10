'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import './globals.css';
import AppErrorView from '@/components/errors/AppErrorView';

/**
 * Last-resort error page, shown when the root layout itself fails (the pages' own error.tsx files
 * handle everything below it). It replaces the whole document, so it brings its own <html>, <body>
 * and styles.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        <title>Something went wrong | 1Think 2Win</title>
        <AppErrorView error={error} retry={retry} />
      </body>
    </html>
  );
}
