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
}

const defaultActions: QuickAction[] = [
    {
        id: 'deposit',
        label: 'Deposit',
        gradient: 'from-emerald-400 to-green-500',
        href: '/profile/wallet',
        icon: (
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
        ),
    },
    {
        id: 'history',
        label: 'History',
        gradient: 'from-blue-400 to-purple-500',
        href: '/profile/wallet',
        icon: (
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    },
    {
        id: 'prizes',
        label: 'Prizes',
        gradient: 'from-yellow-400 to-orange-500',
        href: '/prizes',
        icon: (
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
        ),
    },
    {
        id: 'settings',
        label: 'Settings',
        gradient: 'from-slate-400 to-slate-600',
        href: '/profile/change-password',
        icon: (
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
        ),
    },
];

export default function QuickActions({ actions = defaultActions }: QuickActionsProps) {
    return (
        <div className="flex justify-center gap-6">
            {actions.map((action) => {
                const content = (
                    <div className="flex flex-col items-center gap-2 group">
                        <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${action.gradient} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-200`}>
                            {action.icon}
                        </div>
                        <span className="text-xs text-slate-300 font-medium">{action.label}</span>
                    </div>
                );

                if (action.href) {
                    return (
                        <Link key={action.id} href={action.href}>
                            {content}
                        </Link>
                    );
                }

                return (
                    <button key={action.id} onClick={action.onClick} className="cursor-pointer">
                        {content}
                    </button>
                );
            })}
        </div>
    );
}
