'use client';

import { SessionProvider } from 'next-auth/react';
import { ProfileProvider } from '@/contexts/ProfileContext';

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <ProfileProvider>
        {children}
      </ProfileProvider>
    </SessionProvider>
  );
}