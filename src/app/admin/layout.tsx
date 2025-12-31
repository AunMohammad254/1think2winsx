import { ReactNode } from 'react';

interface AdminLayoutProps {
    children: ReactNode;
}

/**
 * Root Admin Layout
 * This is a minimal wrapper for all admin routes.
 * Auth is handled by the (protected) group layout.
 * The (public) group (login page) has no auth check.
 */
export default function AdminLayout({ children }: AdminLayoutProps) {
    return <>{children}</>;
}
