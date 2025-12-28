'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';

interface AdminLayoutProps {
    children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [isChecking, setIsChecking] = useState(true);
    const [isAuthorized, setIsAuthorized] = useState(false);

    // Skip auth check for the login page itself
    const isLoginPage = pathname === '/admin/login';

    useEffect(() => {
        if (isLoginPage) {
            setIsChecking(false);
            setIsAuthorized(true);
            return;
        }

        const checkAdminAuth = async () => {
            try {
                // Check if admin session exists by calling the verify endpoint
                const response = await fetch('/api/admin/verify', {
                    method: 'GET',
                    credentials: 'include',
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.isAdmin) {
                        setIsAuthorized(true);
                    } else {
                        // Not admin, redirect to admin login
                        router.replace(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
                    }
                } else {
                    // Not authenticated, redirect to admin login
                    router.replace(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
                }
            } catch (error) {
                console.error('Admin auth check failed:', error);
                // On error, redirect to admin login
                router.replace(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
            } finally {
                setIsChecking(false);
            }
        };

        checkAdminAuth();
    }, [pathname, router, isLoginPage]);

    // Show loading state while checking authentication
    if (isChecking && !isLoginPage) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-purple-500 mx-auto mb-4" />
                    <p className="text-gray-400 text-lg">Verifying admin access...</p>
                </div>
            </div>
        );
    }

    // If not authorized and not on login page, don't render children
    if (!isAuthorized && !isLoginPage) {
        return null;
    }

    return <>{children}</>;
}
