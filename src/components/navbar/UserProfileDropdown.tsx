'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { User, LogOut, ChevronDown } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';

interface UserProfileDropdownProps {
    user: SupabaseUser;
    onSignOut: () => void;
}

export default function UserProfileDropdown({ user, onSignOut }: UserProfileDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Get user display name and initial
    const displayName = user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
    const initial = displayName.charAt(0).toUpperCase();

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Close dropdown on escape key
    useEffect(() => {
        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        }

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, []);

    return (
        <div ref={dropdownRef} className="relative">
            {/* Avatar Button */}
            <motion.button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 p-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
            >
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                    <span className="text-sm font-bold text-white">{initial}</span>
                </div>

                {/* Name (hidden on small screens) */}
                <span className="hidden md:block text-sm font-medium text-white/90 pr-1 max-w-[120px] truncate">
                    {displayName}
                </span>

                {/* Chevron */}
                <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="hidden md:block"
                >
                    <ChevronDown className="w-4 h-4 text-white/60" />
                </motion.div>
            </motion.button>

            {/* Dropdown Menu */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className="absolute right-0 top-full mt-2 w-56 origin-top-right"
                    >
                        <div className="rounded-xl bg-gray-900/95 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50 overflow-hidden">
                            {/* User Info Header */}
                            <div className="px-4 py-3 border-b border-white/10">
                                <p className="text-sm font-medium text-white truncate">{displayName}</p>
                                <p className="text-xs text-white/50 truncate">{user.email}</p>
                            </div>

                            {/* Menu Items */}
                            <div className="py-1">
                                <Link
                                    href="/profile"
                                    onClick={() => setIsOpen(false)}
                                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/80 hover:text-white hover:bg-white/5 transition-colors"
                                >
                                    <User className="w-4 h-4" />
                                    <span>Profile</span>
                                </Link>

                                <button
                                    onClick={() => {
                                        setIsOpen(false);
                                        onSignOut();
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                                >
                                    <LogOut className="w-4 h-4" />
                                    <span>Sign Out</span>
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
