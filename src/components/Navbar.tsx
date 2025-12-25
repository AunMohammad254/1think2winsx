'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Type definitions for navigation items
interface NavigationItem {
  href: string;
  label: string;
  icon: string;
}

export default function Navbar() {
  const { user, isLoading, signOut } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const router = useRouter();

  // Navigation items with proper typing
  const baseNavItems: NavigationItem[] = [
    { href: '/', label: 'Home', icon: '🏠' },
    { href: '/quizzes', label: 'Quizzes', icon: '📝' },
    { href: '/how-to-play', label: 'How to Play', icon: '❓' },
    { href: '/prizes', label: 'Prizes', icon: '🏆' },
    { href: '/leaderboard', label: 'Leaderboard', icon: '📊' },
  ];

  const userNavItems: NavigationItem[] = user
    ? [{ href: '/profile', label: 'Profile', icon: '👤' }]
    : [];

  const allNavItems: NavigationItem[] = [...baseNavItems, ...userNavItems];

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
    router.refresh();
  };

  // Get user display name from metadata or email
  const getUserDisplayName = () => {
    if (!user) return '';
    return user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
  };

  const getUserInitial = () => {
    const name = getUserDisplayName();
    return name.charAt(0).toUpperCase();
  };

  return (
    <>
      {/* Simplified Background for Mobile Performance */}
      <div className="fixed top-0 left-0 w-full h-20 z-30 overflow-hidden pointer-events-none">
        {/* Reduced animations - only pulse on larger screens */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-blue-800/20 md:animate-pulse"></div>
        {/* Removed bounce animation for mobile performance */}
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-transparent via-blue-500/5 to-transparent hidden md:block md:animate-bounce" style={{ animationDuration: '3s' }}></div>
      </div>

      <header className="fixed top-0 left-0 w-full z-50 bg-gray-900/90 md:backdrop-blur-xl md:bg-gradient-to-r md:from-gray-900/80 md:via-blue-900/60 md:to-gray-900/80 border-b border-white/10 shadow-lg md:shadow-2xl">
        <div className="container mx-auto px-2 sm:px-4">
          <div className="flex justify-between items-center h-16 sm:h-18 py-2 min-w-0">

            {/* Logo Section - Simplified for mobile */}
            <div className="flex items-center space-x-2 sm:space-x-6 flex-shrink-0 min-w-0">
              <Link href="/" className="group flex items-center space-x-1.5 sm:space-x-2.5 min-w-0">
                <div className="relative flex-shrink-0">
                  {/* Simplified glow effect - only on hover for larger screens */}
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full opacity-0 md:group-hover:opacity-50 transition-opacity duration-300 md:blur-lg"></div>
                  <div className="relative bg-gradient-to-r from-blue-600 to-purple-700 p-1 sm:p-1.5 rounded-full border border-white/20 shadow-md md:shadow-lg overflow-hidden">
                    <Image
                      src="/auth-logo.png"
                      alt="Logo"
                      width={28}
                      height={28}
                      className="w-5 h-5 sm:w-7 sm:h-7 rounded-full"
                    />
                  </div>
                </div>
                <div className="hidden xs:block min-w-0 flex-shrink">
                  <h1 className="text-sm sm:text-xl font-bold bg-gradient-to-r from-white via-blue-200 to-purple-200 bg-clip-text text-transparent leading-tight truncate">
                    Kheelo Or Jeeto
                  </h1>
                  <p className="text-xs text-gray-300 -mt-0.5 leading-none truncate">Cricket Excellence</p>
                </div>
              </Link>

              {/* Desktop Navigation - Simplified hover effects */}
              <nav className="hidden lg:flex space-x-1 flex-1 min-w-0">
                {allNavItems.map((item: NavigationItem) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group relative px-2 xl:px-3 py-2 rounded-lg transition-colors duration-200 hover:bg-white/10 flex-shrink-0"
                  >
                    <div className="flex items-center space-x-1 xl:space-x-1.5">
                      <span className="text-xs xl:text-sm opacity-70 group-hover:opacity-100 transition-opacity duration-200">
                        {item.icon}
                      </span>
                      <span className="text-white/90 group-hover:text-white font-medium text-xs xl:text-sm truncate">
                        {item.label}
                      </span>
                    </div>
                    {/* Simplified underline animation */}
                    <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-blue-400 group-hover:w-full transition-all duration-200"></div>
                  </Link>
                ))}
              </nav>
            </div>

            {/* Auth Section - Simplified for mobile */}
            <div className="flex items-center space-x-1 sm:space-x-3 flex-shrink-0 min-w-0">
              {isLoading ? (
                <div className="animate-pulse flex items-center space-x-2">
                  <div className="h-8 w-20 bg-white/10 rounded-lg"></div>
                </div>
              ) : user ? (
                <div className="flex items-center space-x-1 sm:space-x-3 min-w-0">
                  {/* User Welcome - Simplified background */}
                  <div className="hidden md:flex items-center space-x-2 lg:space-x-2.5 px-2 lg:px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 min-w-0 max-w-[200px] xl:max-w-none">
                    <div className="w-6 h-6 lg:w-7 lg:h-7 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-bold">
                        {getUserInitial()}
                      </span>
                    </div>
                    <div className="text-left min-w-0 flex-1">
                      <p className="text-white text-xs lg:text-sm font-medium leading-tight truncate">Welcome back!</p>
                      <p className="text-gray-300 text-xs leading-none truncate" title={getUserDisplayName()}>
                        {getUserDisplayName()}
                      </p>
                    </div>
                  </div>

                  {/* Sign Out Button - Simplified effects */}
                  <button
                    onClick={handleSignOut}
                    className="group relative px-3 sm:px-6 py-2 sm:py-2.5 rounded-lg bg-red-500/20 border border-red-400/30 text-white font-medium text-xs sm:text-sm hover:bg-red-500/30 hover:border-red-400/50 transition-colors duration-200 flex-shrink-0"
                  >
                    <div className="flex items-center space-x-1 sm:space-x-2">
                      <span className="text-xs sm:text-sm">🚪</span>
                      <span className="hidden sm:inline">Sign Out</span>
                    </div>
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-1 sm:space-x-3">
                  {/* Login Button - Simplified */}
                  <Link
                    href="/login"
                    className="group relative px-3 sm:px-6 py-2 sm:py-2.5 rounded-lg border border-white/20 text-white font-medium text-xs sm:text-sm hover:bg-white/10 hover:border-white/30 transition-colors duration-200 flex-shrink-0"
                  >
                    <div className="flex items-center space-x-1 sm:space-x-2">
                      <span className="text-xs sm:text-sm">🔑</span>
                      <span className="hidden sm:inline">Login</span>
                    </div>
                  </Link>

                  {/* Register Button - Simplified */}
                  <Link
                    href="/register"
                    className="group relative px-3 sm:px-6 py-2 sm:py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium text-xs sm:text-sm hover:from-blue-500 hover:to-purple-500 transition-colors duration-200 shadow-md md:shadow-lg border border-white/20 flex-shrink-0"
                  >
                    <div className="flex items-center space-x-1 sm:space-x-2">
                      <span className="text-xs sm:text-sm">✨</span>
                      <span className="hidden sm:inline">Register</span>
                    </div>
                  </Link>
                </div>
              )}

              {/* Mobile Menu Button - Simplified */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="lg:hidden p-1 sm:p-1.5 rounded-lg bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-colors duration-200 flex-shrink-0"
              >
                <div className="w-4 h-4 sm:w-5 sm:h-5 flex flex-col justify-center items-center space-y-0.5">
                  <div className={`w-3 sm:w-3.5 h-0.5 bg-white transition-transform duration-200 ${isMobileMenuOpen ? 'rotate-45 translate-y-1' : ''}`}></div>
                  <div className={`w-3 sm:w-3.5 h-0.5 bg-white transition-opacity duration-200 ${isMobileMenuOpen ? 'opacity-0' : ''}`}></div>
                  <div className={`w-3 sm:w-3.5 h-0.5 bg-white transition-transform duration-200 ${isMobileMenuOpen ? '-rotate-45 -translate-y-1' : ''}`}></div>
                </div>
              </button>
            </div>
          </div>

          {/* Mobile Menu - Simplified background */}
          <div className={`lg:hidden absolute top-full left-0 w-full bg-gray-900/95 md:backdrop-blur-xl border-t border-white/10 shadow-lg md:shadow-2xl transition-all duration-200 overflow-hidden z-50 ${isMobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="py-2 sm:py-3 space-y-1 container mx-auto px-2 sm:px-4">
              {[
                { href: '/', label: 'Home', icon: '🏠' },
                { href: '/quizzes', label: 'Quizzes', icon: '📝' },
                { href: '/how-to-play', label: 'How to Play', icon: '❓' },
                { href: '/prizes', label: 'Prizes', icon: '🏆' },
                { href: '/leaderboard', label: 'Leaderboard', icon: '📊' },
                ...(user ? [{ href: '/profile', label: 'Profile', icon: '👤' }] : [])
              ].map((item: NavigationItem) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center space-x-2 sm:space-x-2.5 px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg text-white/90 hover:text-white hover:bg-white/10 transition-colors duration-200"
                >
                  <span className="text-sm sm:text-base flex-shrink-0">{item.icon}</span>
                  <span className="font-medium text-sm truncate">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Spacer to prevent content from being hidden behind fixed navbar */}
      <div className="h-16 sm:h-18"></div>
    </>
  );
}