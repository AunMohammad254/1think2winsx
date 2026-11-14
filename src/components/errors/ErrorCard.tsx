import type { ReactNode } from 'react';

export const primaryActionClass =
    'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all';
export const secondaryActionClass =
    'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors';

interface ErrorCardProps {
    /** Big status line above the icon, e.g. "404" */
    code?: string;
    icon: ReactNode;
    title: string;
    message: ReactNode;
    /** Shown small at the bottom, to match a report with the server logs */
    digest?: string;
    /** The buttons and links; style them with primaryActionClass / secondaryActionClass */
    children: ReactNode;
}

/** The site's full-page "something is wrong" card: 404s, crashed pages, no internet. */
export default function ErrorCard({ code, icon, title, message, digest, children }: ErrorCardProps) {
    return (
        <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
            <div className="max-w-md w-full bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-white/10 p-8 text-center shadow-2xl">
                {code && (
                    <p className="text-6xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                        {code}
                    </p>
                )}
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-300">
                    {icon}
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
                <p className="text-gray-400 mb-6">{message}</p>
                <div className="flex flex-col sm:flex-row gap-3">{children}</div>
                {digest && <p className="mt-6 text-xs text-gray-500">Error ID: {digest}</p>}
            </div>
        </div>
    );
}
