'use client';

import { useReportWebVitals } from 'next/web-vitals';

export function WebVitals() {
    useReportWebVitals((metric) => {
        // In development, log to console
        if (process.env.NODE_ENV === 'development') {
            console.log('Web Vital:', metric);
        }
    });

    return null;
}
