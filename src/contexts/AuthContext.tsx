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
                const { data: { session: initialSession }, error } = await supabase.auth.getSession();

                // Handle refresh token errors
                if (error) {
                    console.warn('[AuthContext] Session error:', error.message);
                    // If there's an error (like invalid refresh token), clear the session
                    if (error.message?.includes('Refresh Token') ||
                        error.code === 'refresh_token_not_found') {
                        // Sign out to clear invalid tokens
                        await supabase.auth.signOut();
                        setSession(null);
                        setUser(null);
                        return;
                    }
                }

                setSession(initialSession);
                setUser(initialSession?.user ?? null);
            } catch (error) {
                console.error('[AuthContext] Error getting initial session:', error);
                // Clear session on unexpected errors
                setSession(null);
                setUser(null);
            } finally {
                setIsLoading(false);
            }
        };

        getInitialSession();

        // Listen for auth state changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, newSession) => {
                // Handle token refresh errors
                if (event === 'TOKEN_REFRESHED' && !newSession) {
                    console.warn('[AuthContext] Token refresh failed, clearing session');
                    setSession(null);
                    setUser(null);
                } else if (event === 'SIGNED_OUT') {
                    setSession(null);
                    setUser(null);
                } else {
                    setSession(newSession);
                    setUser(newSession?.user ?? null);
                }
                setIsLoading(false);
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const signOut = async () => {
        try {
            await supabase.auth.signOut();
            // Clear local state
            setSession(null);
            setUser(null);
            // Redirect to login page
            window.location.href = '/login';
        } catch (error) {
            console.error('[AuthContext] Sign out error:', error);
            // Force clear local state even if sign out fails
            setSession(null);
            setUser(null);
            // Still redirect to login
            window.location.href = '/login';
        }
    };

    return (
        <AuthContext.Provider value={{ user, session, isLoading, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

