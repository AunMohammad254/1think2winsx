'use client';

import { useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Home, FileText, HelpCircle, Trophy, BarChart3, User, LogIn, Sparkles } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';

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

// Staggered animation variants - inspired by ReactBits staggered menu
const menuVariants = {
    closed: {
        opacity: 0,
        x: '100%',
        transition: {
            duration: 0.3,
            ease: 'easeInOut' as const,
            staggerChildren: 0.05,
            staggerDirection: -1,
        },
    },
    open: {
        opacity: 1,
        x: 0,
        transition: {
            duration: 0.4,
            ease: 'easeOut' as const,
            staggerChildren: 0.08,
            delayChildren: 0.15,
        },
    },
};

const itemVariants = {
    closed: {
        opacity: 0,
        x: 50,
        y: 10,
        scale: 0.9,
        filter: 'blur(4px)',
    },
    open: {
        opacity: 1,
        x: 0,
        y: 0,
        scale: 1,
        filter: 'blur(0px)',
        transition: {
            duration: 0.4,
            ease: 'easeOut' as const,
        },
    },
};

const overlayVariants = {
    closed: {
        opacity: 0,
    },
    open: {
        opacity: 1,
        transition: {
            duration: 0.3,
        },
    },
};

export default function MobileNav({ isOpen, onClose, user, onSignOut }: MobileNavProps) {
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

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop Overlay */}
                    <motion.div
                        variants={overlayVariants}
                        initial="closed"
                        animate="open"
                        exit="closed"
                        onClick={onClose}
                        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
                    />

                    {/* Slide-in Menu Panel */}
                    <motion.div
                        variants={menuVariants}
                        initial="closed"
                        animate="open"
                        exit="closed"
                        className="fixed top-0 right-0 z-50 h-full w-[85%] max-w-sm lg:hidden"
                    >
                        {/* Glass Panel */}
                        <div className="h-full bg-gray-900/95 backdrop-blur-2xl border-l border-white/10 shadow-2xl shadow-black/50 flex flex-col">
                            {/* Header */}
                            <div className="flex items-center justify-between p-4 border-b border-white/10">
                                <motion.span
                                    variants={itemVariants}
                                    className="text-lg font-bold text-white font-montserrat"
                                >
                                    Menu
                                </motion.span>
                                <motion.button
                                    variants={itemVariants}
                                    onClick={onClose}
                                    className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                >
                                    <X className="w-5 h-5" />
                                </motion.button>
                            </div>

                            {/* Navigation Links */}
                            <nav className="flex-1 overflow-y-auto py-6 px-4">
                                <ul className="space-y-2">
                                    {allNavItems.map((item) => {
                                        const Icon = item.icon;
                                        return (
                                            <motion.li key={item.href} variants={itemVariants}>
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
                                            </motion.li>
                                        );
                                    })}
                                </ul>
                            </nav>

                            {/* Auth Section */}
                            <motion.div
                                variants={itemVariants}
                                className="p-4 border-t border-white/10"
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
                            </motion.div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
