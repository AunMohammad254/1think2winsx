import { ReactNode } from 'react';

interface LoginLayoutProps {
    children: ReactNode;
}

/**
 * Admin Login Layout - No auth check
 * This layout allows the login page to be accessed without authentication.
 */
export default function AdminLoginLayout({ children }: LoginLayoutProps) {
    return <>{children}</>;
}
