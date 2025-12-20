'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
    user: User | null;
    session: Session | null;
    isLoading: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    session: null,
    isLoading: true,
    signOut: async () => { },
});

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

interface AuthProviderProps {
    children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const supabase = createClient();

    useEffect(() => {
        // Get initial session
        const getInitialSession = async () => {
            try {
                const { data: { session: initialSession } } = await supabase.auth.getSession();
                setSession(initialSession);
                setUser(initialSession?.user ?? null);

                // Sync user to Prisma on initial session load
                if (initialSession?.user) {
                    try {
                        await fetch('/api/auth/sync-user', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: initialSession.user.id,
                                email: initialSession.user.email,
                                name: initialSession.user.user_metadata?.name || initialSession.user.user_metadata?.full_name,
                                phone: initialSession.user.user_metadata?.phone,
                            }),
                        });
                    } catch (error) {
                        console.error('Error syncing user on initial session:', error);
                    }
                }
            } catch (error) {
                console.error('Error getting initial session:', error);
            } finally {
                setIsLoading(false);
            }
        };

        getInitialSession();

        // Listen for auth state changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, newSession) => {
                setSession(newSession);
                setUser(newSession?.user ?? null);
                setIsLoading(false);

                // Sync user to Prisma on sign in
                if (event === 'SIGNED_IN' && newSession?.user) {
                    try {
                        await fetch('/api/auth/sync-user', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: newSession.user.id,
                                email: newSession.user.email,
                                name: newSession.user.user_metadata?.name || newSession.user.user_metadata?.full_name,
                                phone: newSession.user.user_metadata?.phone,
                            }),
                        });
                    } catch (error) {
                        console.error('Error syncing user on sign in:', error);
                    }
                }
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, [supabase.auth]);

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    return (
        <AuthContext.Provider value={{ user, session, isLoading, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}
