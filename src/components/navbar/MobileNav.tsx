'use client';

import { useEffect, useCallback } from 'react';
import Link from 'next/link';
import { X, Home, FileText, HelpCircle, Trophy, BarChart3, User, LogIn, Sparkles } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { usePresence } from '@/hooks/usePresence';

// Navigation items configuration
const navItems = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/quizzes', label: 'Quizzes', icon: FileText },
    { href: '/how-to-play', label: 'How-To-Play', icon: HelpCircle },
    { href: '/prizes', label: 'Prizes', icon: Trophy },
    { href: '/leaderboard', label: 'Leaderboard', icon: BarChart3 },
];

interface MobileNavProps {
    isOpen: boolean;
    onClose: () => void;
    user: SupabaseUser | null;
    onSignOut: () => void;
}

// Matches the slide-out in globals.css (.menu-panel[data-state="closed"])
const EXIT_MS = 300;

// Staggered entrance, inspired by ReactBits' staggered menu: each row follows the panel in
const itemDelay = (index: number) => ({ animationDelay: `${0.15 + index * 0.08}s` });

export default function MobileNav({ isOpen, onClose, user, onSignOut }: MobileNavProps) {
    const mounted = usePresence(isOpen, EXIT_MS);

    // Lock body scroll when menu is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    // Close on escape key
    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            onClose();
        }
    }, [onClose]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    // Get all nav items including profile if logged in
    const allNavItems = user
        ? [...navItems, { href: '/profile', label: 'Profile', icon: User }]
        : navItems;

    if (!mounted) return null;
    const state = isOpen ? 'open' : 'closed';

    return (
        <>
            {/* Backdrop Overlay */}
            <div
                data-state={state}
                onClick={onClose}
                className="menu-overlay fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            />

            {/* Slide-in Menu Panel */}
            <div
                data-state={state}
                className="menu-panel fixed top-0 right-0 z-50 h-full w-[85%] max-w-sm lg:hidden"
            >
                {/* Glass Panel */}
                <div className="h-full bg-gray-900/95 backdrop-blur-2xl border-l border-white/10 shadow-2xl shadow-black/50 flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-white/10">
                        <span
                            className="menu-item-enter text-lg font-bold text-white font-poppins"
                            style={itemDelay(0)}
                        >
                            Menu
                        </span>
                        <button
                            onClick={onClose}
                            className="menu-item-enter p-2 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition motion-safe:hover:scale-105 motion-safe:active:scale-95"
                            style={itemDelay(1)}
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Navigation Links */}
                    <nav className="flex-1 overflow-y-auto py-6 px-4">
                        <ul className="space-y-2">
                            {allNavItems.map((item, index) => {
                                const Icon = item.icon;
                                return (
                                    <li key={item.href} className="menu-item-enter" style={itemDelay(index + 2)}>
                                        <Link
                                            href={item.href}
                                            onClick={onClose}
                                            className="group flex items-center gap-4 px-4 py-3.5 rounded-xl text-white/80 hover:text-white bg-white/0 hover:bg-white/5 border border-transparent hover:border-white/10 transition-all duration-200"
                                        >
                                            <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/5 group-hover:from-blue-500/30 group-hover:to-purple-500/30 transition-colors">
                                                <Icon className="w-5 h-5" />
                                            </div>
                                            <span className="text-base font-medium">{item.label}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>

                    {/* Auth Section */}
                    <div
                        className="menu-item-enter p-4 border-t border-white/10"
                        style={itemDelay(allNavItems.length + 2)}
                    >
                        {user ? (
                            <button
                                onClick={() => {
                                    onSignOut();
                                    onClose();
                                }}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 hover:text-red-300 transition-colors font-medium"
                            >
                                <X className="w-5 h-5" />
                                <span>Sign Out</span>
                            </button>
                        ) : (
                            <div className="space-y-3">
                                <Link
                                    href="/login"
                                    onClick={onClose}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors font-medium"
                                >
                                    <LogIn className="w-5 h-5" />
                                    <span>Sign In</span>
                                </Link>
                                <Link
                                    href="/register"
                                    onClick={onClose}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white border border-white/20 transition-colors font-medium shadow-lg shadow-purple-500/20"
                                >
                                    <Sparkles className="w-5 h-5" />
                                    <span>Get Started</span>
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
