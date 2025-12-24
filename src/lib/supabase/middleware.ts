import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // IMPORTANT: Do not write any logic between createServerClient and
    // supabase.auth.getUser(). A simple mistake could cause hard-to-debug
    // issues with users being randomly logged out.

    // Wrap getUser in try-catch to handle refresh token errors gracefully
    let user = null
    try {
        const { data, error } = await supabase.auth.getUser()
        if (error) {
            // Handle refresh token errors by clearing stale session
            if (error.message?.includes('Refresh Token') ||
                error.code === 'refresh_token_not_found' ||
                error.name === 'AuthApiError') {
                // Clear all auth-related cookies to force re-authentication
                const authCookies = request.cookies.getAll().filter(c =>
                    c.name.startsWith('sb-') || c.name.includes('supabase')
                )
                authCookies.forEach(cookie => {
                    supabaseResponse.cookies.delete(cookie.name)
                })
                console.log('[Auth Middleware] Cleared stale auth cookies due to refresh token error')
            }
        } else {
            user = data.user
        }
    } catch (error) {
        console.error('[Auth Middleware] Error getting user:', error)
        // Clear cookies on any auth error
        const authCookies = request.cookies.getAll().filter(c =>
            c.name.startsWith('sb-') || c.name.includes('supabase')
        )
        authCookies.forEach(cookie => {
            supabaseResponse.cookies.delete(cookie.name)
        })
    }

    // Protected routes that require authentication
    const protectedPaths = [
        '/profile',
        '/quiz',
        '/quizzes',
    ]

    const isProtectedPath = protectedPaths.some(path =>
        request.nextUrl.pathname.startsWith(path)
    )

    if (isProtectedPath && !user) {
        // Redirect unauthenticated users to login
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        url.searchParams.set('redirect', request.nextUrl.pathname)
        return NextResponse.redirect(url)
    }

    // Redirect authenticated users away from login/register
    const authPaths = ['/login', '/register']
    const isAuthPath = authPaths.some(path =>
        request.nextUrl.pathname === path
    )

    if (isAuthPath && user) {
        const url = request.nextUrl.clone()
        url.pathname = '/quizzes'
        return NextResponse.redirect(url)
    }

    // IMPORTANT: You *must* return the supabaseResponse object as is.
    // Return any modified response to keep cookies in sync.
    return supabaseResponse
}
