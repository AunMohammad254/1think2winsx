'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { ProfileProvider } from '@/contexts/ProfileContext';

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <ProfileProvider>
        {children}
      </ProfileProvider>
    </AuthProvider>
  );
}