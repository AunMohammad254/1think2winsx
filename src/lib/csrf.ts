'use client';

/**
 * CSRF Client Utility
 * Provides helpers for fetching and managing CSRF tokens in the frontend
 */

/**
 * Fetches a fresh CSRF token from the API
 * Use this before making any mutating requests (POST, PUT, DELETE, PATCH)
 */
export async function getCSRFToken(): Promise<string | null> {
    try {
        const response = await fetch('/api/csrf-token');
        if (!response.ok) throw new Error('Failed to fetch CSRF token');
        const data = await response.json();
        return data.csrfToken;
    } catch (error) {
        console.error('Error fetching CSRF token:', error);
        return null;
    }
}

/**
 * Helper to include CSRF token in fetch headers
 */
export async function getCSRFHeaders(): Promise<Record<string, string>> {
    const token = await getCSRFToken();
    return token ? { 'x-csrf-token': token } : {};
}
