'use client';

import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import { useEffect } from 'react';

/**
 * Last-resort error page, shown when the root layout itself fails (the pages' own error.tsx files
 * handle everything below it). It replaces the whole document, so it brings its own <html> and <body>.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* The App Router gives error pages no status code, so the generic message (0) is shown */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
