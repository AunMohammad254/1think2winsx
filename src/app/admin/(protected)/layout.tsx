import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { validateAdminSession } from '@/lib/admin-session';

interface AdminLayoutProps {
    children: ReactNode;
}

/**
 * Admin Layout - Server Component
 * Validates admin session before rendering any children.
 * Redirects to login if not authenticated.
 * 
 * Note: The login page (/admin/login) has its own layout that 
 * skips this auth check.
 */
export default async function AdminProtectedLayout({ children }: AdminLayoutProps) {
    // Validate admin session from database
    const session = await validateAdminSession();

    if (!session.valid) {
        // Redirect to admin login
        redirect('/admin/login');
    }

    return <>{children}</>;
}
