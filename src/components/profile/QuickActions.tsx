'use client';

import Link from 'next/link';

interface QuickAction {
    id: string;
    label: string;
    icon: React.ReactNode;
    href?: string;
    onClick?: () => void;
    gradient: string;
}

interface QuickActionsProps {
    actions?: QuickAction[];
    onChangePasswordClick?: () => void;
    /** Hide the Deposit/History actions (wallet feature disabled). */
    hideWalletActions?: boolean;
}

// Theme-aligned gradients (4 distinct semantic categories)
const defaultActions: QuickAction[] = [
    {
        id: 'deposit',
        label: 'Deposit',
        gradient: 'from-emerald-700 to-teal-700',
        href: '/profile/wallet',
        icon: (
            <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
            </svg>
        ),
    },
    {
        id: 'history',
        label: 'History',
        gradient: 'from-blue-600 to-blue-800',
        href: '/profile/wallet',
        icon: (
            <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
            </svg>
        ),
    },
    {
        id: 'prizes',
        label: 'Prizes',
        gradient: 'from-amber-500 to-amber-700',
        href: '/prizes',
        icon: (
            <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
                />
            </svg>
        ),
    },
    {
        id: 'changePassword',
        label: 'Password',
        gradient: 'from-slate-500 to-slate-700',
        icon: (
            <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
            </svg>
        ),
    },
];

export default function QuickActions({ actions = defaultActions, onChangePasswordClick, hideWalletActions }: QuickActionsProps) {
    const visibleActions = hideWalletActions
        ? actions.filter((a) => a.id !== 'deposit' && a.id !== 'history')
        : actions;
    const actionsWithHandlers = visibleActions.map((action) => {
        if (action.id === 'changePassword' && onChangePasswordClick) {
            return { ...action, onClick: onChangePasswordClick };
        }
        return action;
    });

    return (
        <nav
            aria-label="Profile quick actions"
            className="flex justify-center gap-4 sm:gap-6"
        >
            {actionsWithHandlers.map((action) => {
                const content = (
                    <div className="flex flex-col items-center gap-2 group">
                        <div
                            className={`w-14 h-14 rounded-full bg-linear-to-br ${action.gradient} flex items-center justify-center shadow-lg group-hover:scale-110 group-focus-visible:scale-110 transition-transform duration-200 ring-2 ring-white/10`}
                            aria-hidden="true"
                        >
                            {action.icon}
                        </div>
                        <span className="text-xs text-slate-300 font-medium">
                            {action.label}
                        </span>
                    </div>
                );

                if (action.href) {
                    return (
                        <Link
                            key={action.id}
                            href={action.href}
                            aria-label={action.label}
                            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                        >
                            {content}
                        </Link>
                    );
                }

                return (
                    <button
                        key={action.id}
                        type="button"
                        onClick={action.onClick}
                        aria-label={action.label}
                        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                    >
                        {content}
                    </button>
                );
            })}
        </nav>
    );
}
