'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, LogIn, Sparkles, Home, FileText, HelpCircle, Trophy, BarChart3, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Logo from './navbar/Logo';
import UserProfileDropdown from './navbar/UserProfileDropdown';
import MobileNav from './navbar/MobileNav';

// Navigation items configuration
const navItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/quizzes', label: 'Quizzes', icon: FileText },
  { href: '/how-to-play', label: 'How-To-Play', icon: HelpCircle },
  { href: '/prizes', label: 'Prizes', icon: Trophy },
  { href: '/leaderboard', label: 'Leaderboard', icon: BarChart3 },
];

// Animation variants
const navbarVariants = {
  hidden: { opacity: 0, y: -20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: 'easeOut' as const,
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const linkVariants = {
  hidden: { opacity: 0, y: -10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: 'easeOut' as const,
    },
  },
};

export default function Navbar() {
  const { user, isLoading, signOut } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Handle scroll for enhanced glassmorphism effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Get all nav items including profile if logged in
  const allNavItems = user
    ? [...navItems, { href: '/profile', label: 'Profile', icon: User }]
    : navItems;

  return (
    <>
      {/* Main Navbar */}
      <motion.header
        variants={navbarVariants}
        initial="hidden"
        animate="visible"
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled
          ? 'bg-black/60 backdrop-blur-2xl shadow-lg shadow-black/20'
          : 'bg-black/30 backdrop-blur-xl'
          } border-b border-white/10`}
      >
        <div className="container mx-auto px-4 lg:px-6">
          <div className="flex items-center justify-between h-16 md:h-18">
            {/* Logo */}
            <Logo />

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-0.5 xl:gap-1">
              {allNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <motion.div key={item.href} variants={linkVariants}>
                    <Link
                      href={item.href}
                      className="group relative flex items-center gap-1.5 px-2.5 xl:px-3.5 py-2 rounded-lg text-white/70 hover:text-white transition-colors duration-200"
                    >
                      <Icon className="w-4 h-4 opacity-70 group-hover:opacity-100 transition-opacity" />
                      <span className="text-sm font-medium">{item.label}</span>

                      {/* Hover underline effect */}
                      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 group-hover:w-3/4 transition-all duration-300 rounded-full" />
                    </Link>
                  </motion.div>
                );
              })}
            </nav>

            {/* Auth Section */}
            <div className="flex items-center gap-3">
              {isLoading ? (
                // Loading skeleton
                <div className="flex items-center gap-3">
                  <div className="hidden md:block w-20 h-9 rounded-lg bg-white/10 animate-pulse" />
                  <div className="w-8 h-8 rounded-full bg-white/10 animate-pulse" />
                </div>
              ) : user ? (
                // Logged in state
                <motion.div variants={linkVariants}>
                  <UserProfileDropdown user={user} onSignOut={signOut} />
                </motion.div>
              ) : (
                // Logged out state
                <motion.div variants={linkVariants} className="flex items-center gap-2">
                  {/* Sign In Button */}
                  <Link
                    href="/login"
                    className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg text-white/80 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all duration-200 text-sm font-medium"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Sign In</span>
                  </Link>

                  {/* Get Started Button */}
                  <Link
                    href="/register"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white border border-white/20 transition-all duration-200 text-sm font-medium shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span className="hidden sm:inline">Get Started</span>
                    <span className="sm:hidden">Join</span>
                  </Link>
                </motion.div>
              )}

              {/* Mobile Menu Button */}
              <motion.button
                variants={linkVariants}
                onClick={() => setIsMobileMenuOpen(true)}
                className="lg:hidden p-2 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </motion.button>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Mobile Navigation */}
      <MobileNav
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        user={user}
        onSignOut={signOut}
      />

      {/* Spacer to prevent content from being hidden behind fixed navbar */}
      <div className="h-16 md:h-18" />
    </>
  );
}