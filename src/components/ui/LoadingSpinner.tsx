'use client';

import React from 'react';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg' | 'xl';
    text?: string;
    fullScreen?: boolean;
    className?: string;
}

const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-2',
    lg: 'w-12 h-12 border-3',
    xl: 'w-16 h-16 border-4',
};

export default function LoadingSpinner({
    size = 'md',
    text,
    fullScreen = false,
    className = '',
}: LoadingSpinnerProps) {
    const spinner = (
        <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
            <div
                className={`${sizeClasses[size]} border-blue-400/30 border-t-blue-400 rounded-full animate-spin`}
            />
            {text && (
                <p className="text-sm text-slate-400 animate-pulse">{text}</p>
            )}
        </div>
    );

    if (fullScreen) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
                {spinner}
            </div>
        );
    }

    return spinner;
}

// Inline loading overlay for cards/sections
export function LoadingOverlay({ text }: { text?: string }) {
    return (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm rounded-xl">
            <LoadingSpinner size="lg" text={text} />
        </div>
    );
}

// Skeleton loader for table rows
export function TableRowSkeleton({ columns = 5 }: { columns?: number }) {
    return (
        <tr className="animate-pulse">
            {Array.from({ length: columns }).map((_, i) => (
                <td key={i} className="px-4 py-3">
                    <div className="h-4 bg-slate-700 rounded w-3/4" />
                </td>
            ))}
        </tr>
    );
}

// Skeleton loader for cards
export function CardSkeleton() {
    return (
        <div className="animate-pulse backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="h-4 bg-slate-700 rounded w-1/4 mb-4" />
            <div className="h-8 bg-slate-700 rounded w-1/2 mb-2" />
            <div className="h-3 bg-slate-700 rounded w-3/4" />
        </div>
    );
}
