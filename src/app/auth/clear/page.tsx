'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, CheckCircle2, AlertTriangle, LogIn } from 'lucide-react';
import Link from 'next/link';

export default function ClearAuthPage() {
    const [status, setStatus] = useState<'clearing' | 'success' | 'error'>('clearing');
    const [message, setMessage] = useState('Clearing authentication session...');
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        const clearSession = async () => {
            try {
                // Step 1: Sign out from Supabase
                await supabase.auth.signOut({ scope: 'global' });

                // Step 2: Clear all Supabase-related cookies manually
                const cookies = document.cookie.split(';');
                for (const cookie of cookies) {
                    const cookieName = cookie.split('=')[0].trim();
                    if (cookieName.startsWith('sb-') || cookieName.includes('supabase')) {
                        // Clear cookie by setting expiry to past
                        document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
                        document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`;
                    }
                }

                // Step 3: Clear localStorage items related to Supabase
                const keysToRemove: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(key => localStorage.removeItem(key));

                // Step 4: Clear sessionStorage items related to Supabase
                const sessionKeysToRemove: string[] = [];
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
                        sessionKeysToRemove.push(key);
                    }
                }
                sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));

                setStatus('success');
                setMessage('Session cleared successfully! Redirecting to login...');

                // Redirect to login after 2 seconds
                setTimeout(() => {
                    router.push('/login');
                }, 2000);
            } catch (error) {
                console.error('Error clearing session:', error);
                setStatus('error');
                setMessage('Failed to clear session. Please try clearing your browser cookies manually.');
            }
        };

        clearSession();
    }, [router, supabase.auth]);

    return (
        <div className="min-h-screen relative overflow-hidden">
            {/* Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%224%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20"></div>
            </div>

            <div className="relative z-10 flex min-h-screen flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
                <div className="w-full max-w-md">
                    {/* Logo */}
                    <div className="text-center mb-8">
                        <Link href="/" className="inline-block group">
                            <div className="relative">
                                <div className="absolute -inset-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full blur opacity-75 group-hover:opacity-100 transition duration-300 animate-pulse"></div>
                                <div className="relative bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-full font-bold text-xl shadow-lg transform group-hover:scale-105 transition-all duration-200">
                                    Kheelo Or Jeeto
                                </div>
                            </div>
                        </Link>
                    </div>

                    {/* Card */}
                    <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl p-8">
                        <div className="text-center">
                            {/* Status Icon */}
                            <div className="mb-6 flex justify-center">
                                {status === 'clearing' && (
                                    <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center">
                                        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                                    </div>
                                )}
                                {status === 'success' && (
                                    <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                                        <CheckCircle2 className="w-8 h-8 text-green-400" />
                                    </div>
                                )}
                                {status === 'error' && (
                                    <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                                        <AlertTriangle className="w-8 h-8 text-red-400" />
                                    </div>
                                )}
                            </div>

                            {/* Title */}
                            <h2 className="text-2xl font-bold text-white mb-2">
                                {status === 'clearing' && 'Clearing Session'}
                                {status === 'success' && 'Session Cleared'}
                                {status === 'error' && 'Clear Failed'}
                            </h2>

                            {/* Message */}
                            <p className={`text-sm mb-6 ${status === 'clearing' ? 'text-slate-400' :
                                    status === 'success' ? 'text-green-400' :
                                        'text-red-400'
                                }`}>
                                {message}
                            </p>

                            {/* Progress indicators for clearing status */}
                            {status === 'clearing' && (
                                <div className="space-y-2 text-left text-sm text-slate-400">
                                    <div className="flex items-center space-x-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Signing out from Supabase...</span>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Clearing cookies...</span>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Clearing local storage...</span>
                                    </div>
                                </div>
                            )}

                            {/* Error actions */}
                            {status === 'error' && (
                                <div className="space-y-4">
                                    <div className="p-4 bg-slate-800/50 rounded-xl text-left text-sm text-slate-300">
                                        <p className="font-semibold mb-2">Manual steps to clear cookies:</p>
                                        <ol className="list-decimal list-inside space-y-1">
                                            <li>Open browser DevTools (F12)</li>
                                            <li>Go to Application → Cookies</li>
                                            <li>Select your site</li>
                                            <li>Delete all cookies starting with "sb-"</li>
                                            <li>Refresh the page</li>
                                        </ol>
                                    </div>
                                    <Link
                                        href="/login"
                                        className="inline-flex items-center justify-center w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-blue-700 transition-all duration-200"
                                    >
                                        <LogIn className="w-4 h-4 mr-2" />
                                        Go to Login
                                    </Link>
                                </div>
                            )}

                            {/* Success redirect indication */}
                            {status === 'success' && (
                                <div className="flex items-center justify-center space-x-2 text-slate-400 text-sm">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Redirecting...</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Help text */}
                    <p className="mt-6 text-center text-sm text-slate-500">
                        This page clears your authentication session and fixes login issues.
                    </p>
                </div>
            </div>
        </div>
    );
}
