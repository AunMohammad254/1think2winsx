'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { ProfileProvider } from '@/contexts/ProfileContext';
import { PWAProvider } from '@/contexts/PWAContext';

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <ProfileProvider>
        <PWAProvider>
          {children}
        </PWAProvider>
      </ProfileProvider>
    </AuthProvider>
  );
}