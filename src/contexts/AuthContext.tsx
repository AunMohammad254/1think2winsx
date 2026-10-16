'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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

// Outside an AuthProvider this returns the signed-out defaults above
export function useAuth() {
    return useContext(AuthContext);
}

interface AuthProviderProps {
    children: ReactNode;
}

const supabase = createClient();

/**
 * Supabase fires onAuthStateChange on tab refocus and every token refresh, each time with a
 * brand-new `user` object for the SAME person. Replacing state with it re-ran every effect keyed
 * on `user` (profile, notifications, quiz list ...) and turned a tab switch into a burst of
 * API calls. Keep the previous reference unless the user really changed.
 */
function sameUser(a: User | null, b: User | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.id === b.id && a.updated_at === b.updated_at && a.email === b.email;
}

export function AuthProvider({ children }: AuthProviderProps) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);

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
                const initialUser = initialSession?.user ?? null;
                setUser(prev => sameUser(prev, initialUser) ? prev : initialUser);
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
                    const nextUser = newSession?.user ?? null;
                    setUser(prev => sameUser(prev, nextUser) ? prev : nextUser);
                }
                setIsLoading(false);
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    // ⚡ Bolt Performance Optimization:
    // Memoize the signOut function so its reference remains stable across renders.
    const signOut = React.useCallback(async () => {
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
    }, []);

    // ⚡ Bolt Performance Optimization:
    // Memoize the Context value object to prevent consumers from re-rendering
    // unnecessarily when AuthProvider re-renders due to unrelated state changes.
    // Expected impact: Reduces re-renders of all components utilizing useAuth()
    const value = React.useMemo(() => ({
        user,
        session,
        isLoading,
        signOut
    }), [user, session, isLoading, signOut]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

