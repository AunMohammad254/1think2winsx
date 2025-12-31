'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

function AdminLoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectTo = searchParams.get('redirect') || '/admin/dashboard';

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);

        try {
            const response = await fetch('/api/admin/auth', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Authentication failed');
                return;
            }

            // Redirect to intended page or admin dashboard
            router.push(redirectTo);
        } catch (err) {
            console.error('Admin login error:', err);
            setError('An error occurred. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen relative overflow-hidden">
            {/* Background - Matches app design */}
            <div
                className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.02'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            >
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-blue-500/5 to-pink-500/5 hidden md:block md:animate-pulse"></div>
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-red-500/10 rounded-full blur-3xl hidden md:block md:animate-pulse"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl hidden md:block md:animate-pulse delay-1000"></div>
                <div className="absolute inset-0 md:hidden bg-gradient-to-br from-red-500/5 to-orange-500/5"></div>
            </div>

            {/* Content */}
            <div className="relative z-10 min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    {/* Logo */}
                    <div className="flex justify-center mb-8">
                        <Link href="/" className="group touch-manipulation">
                            <div className="relative">
                                <div className="absolute -inset-2 bg-gradient-to-r from-red-400 via-orange-400 to-yellow-400 rounded-full blur opacity-75 hidden md:block md:group-hover:opacity-100 transition duration-300"></div>
                                <div className="relative">
                                    <Image
                                        src="/cricket-ball.svg"
                                        alt="TBCL Logo"
                                        width={80}
                                        height={80}
                                        className="rounded-full bg-white/5 md:bg-white/10 md:backdrop-blur-xl p-2 border border-white/10 md:border-white/20 shadow-lg md:shadow-2xl transform md:group-hover:scale-110 transition-all duration-300"
                                    />
                                </div>
                            </div>
                        </Link>
                    </div>

                    {/* Header */}
                    <div className="text-center mb-8">
                        <h2 className="text-4xl font-bold bg-gradient-to-r from-red-400 via-orange-400 to-yellow-400 bg-clip-text text-transparent mb-4">
                            Admin Access
                        </h2>
                        <p className="text-slate-300 text-lg">
                            Enter your admin credentials to continue
                        </p>
                        <div className="mt-4 inline-flex items-center px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20">
                            <svg className="w-4 h-4 mr-2 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                            <span className="text-red-300 text-sm font-medium">Restricted Area</span>
                        </div>
                    </div>
                </div>

                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    {/* Login Card */}
                    <div className="bg-white/5 md:backdrop-blur-xl md:bg-white/10 border border-white/10 md:border-white/20 rounded-2xl shadow-lg md:shadow-2xl p-8">
                        {/* Error Message */}
                        {error && (
                            <div className="mb-6 bg-red-500/10 md:backdrop-blur-xl md:bg-red-500/20 border border-red-500/20 md:border-red-500/30 text-red-100 px-4 py-3 rounded-xl shadow-lg">
                                <div className="flex items-center">
                                    <svg className="w-5 h-5 mr-3 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span className="block sm:inline">{error}</span>
                                </div>
                            </div>
                        )}

                        <form className="space-y-6" onSubmit={handleSubmit}>
                            {/* Email Field */}
                            <div>
                                <label htmlFor="email" className="block text-sm font-semibold text-slate-200 mb-2">
                                    Admin Email
                                </label>
                                <div className="relative group">
                                    <div className="absolute inset-0 bg-gradient-to-r from-red-500/10 to-orange-500/10 rounded-xl blur opacity-0 hidden md:block md:group-hover:opacity-100 transition duration-300"></div>
                                    <input
                                        id="email"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        className="relative w-full px-4 py-3 bg-white/5 md:backdrop-blur-xl md:bg-white/10 border border-white/10 md:border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50 transition-all duration-200 shadow-lg"
                                        placeholder="Enter admin email"
                                    />
                                </div>
                            </div>

                            {/* Password Field */}
                            <div>
                                <label htmlFor="password" className="block text-sm font-semibold text-slate-200 mb-2">
                                    Admin Password
                                </label>
                                <div className="relative group">
                                    <div className="absolute inset-0 bg-gradient-to-r from-red-500/10 to-orange-500/10 rounded-xl blur opacity-0 hidden md:block md:group-hover:opacity-100 transition duration-300"></div>
                                    <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        className="relative w-full px-4 py-3 pr-12 bg-white/5 md:backdrop-blur-xl md:bg-white/10 border border-white/10 md:border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50 transition-all duration-200 shadow-lg"
                                        placeholder="Enter admin password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 md:hover:text-white transition-colors duration-200 touch-manipulation"
                                    >
                                        {showPassword ? (
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                                            </svg>
                                        ) : (
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Submit Button */}
                            <div>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="group relative w-full flex justify-center py-3 px-4 border border-transparent rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-orange-600 md:hover:from-red-700 md:hover:to-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transform md:hover:scale-105 transition-all duration-200 shadow-lg md:hover:shadow-red-500/25 touch-manipulation"
                                >
                                    <span className="absolute left-0 inset-y-0 flex items-center pl-3">
                                        {isSubmitting ? (
                                            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                        ) : (
                                            <svg className="h-5 w-5 text-red-300 group-hover:text-white transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                            </svg>
                                        )}
                                    </span>
                                    {isSubmitting ? 'Authenticating...' : 'Access Admin Panel'}
                                </button>
                            </div>
                        </form>

                        {/* Back Link */}
                        <div className="mt-8 pt-6 border-t border-white/10">
                            <div className="text-center">
                                <Link
                                    href="/"
                                    className="inline-flex items-center text-sm text-slate-400 md:hover:text-slate-300 transition-colors duration-200 touch-manipulation"
                                >
                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                                    </svg>
                                    Back to Home
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function AdminLogin() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-400"></div>
            </div>
        }>
            <AdminLoginForm />
        </Suspense>
    );
}
