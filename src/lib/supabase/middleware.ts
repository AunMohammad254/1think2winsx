import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that require a signed-in user.
const PROTECTED_PREFIXES = ['/profile', '/quiz', '/quizzes']
// Signed-in users are bounced away from these.
const AUTH_PATHS = new Set(['/login', '/register'])

function hasSupabaseAuthCookie(request: NextRequest) {
    return request.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('-auth-token'))
}

/**
 * Refreshes the Supabase session and applies route guards.
 *
 * Performance: this used to call `supabase.auth.getUser()` (a network round-trip
 * to Supabase Auth) on EVERY page request. It now:
 *  - skips Supabase entirely for public pages (landing, FAQ, leaderboard, ...),
 *  - skips it for protected pages when no auth cookie exists (straight redirect),
 *  - uses `getClaims()`, which verifies the JWT locally when the project uses
 *    asymmetric JWT signing keys (and falls back to getUser() otherwise).
 */
export async function updateSession(request: NextRequest) {
    const { pathname } = request.nextUrl
    const isProtected = PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
    const isAuthPath = AUTH_PATHS.has(pathname)

    let supabaseResponse = NextResponse.next({ request })

    if (!isProtected && !isAuthPath) {
        return supabaseResponse
    }

    if (!hasSupabaseAuthCookie(request)) {
        if (isProtected) return redirectToLogin(request)
        return supabaseResponse
    }

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
                    supabaseResponse = NextResponse.next({ request })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // IMPORTANT: no logic between createServerClient and the auth call.
    let userId: string | null = null
    try {
        const { data, error } = await supabase.auth.getClaims()
        if (!error && data?.claims?.sub) {
            userId = data.claims.sub
        } else if (error && (error.name === 'AuthApiError' || /refresh token/i.test(error.message))) {
            // Stale/revoked session: clear it so the user can sign in again.
            // (Transient network errors must NOT log everyone out.)
            clearAuthCookies(request, supabaseResponse)
        }
    } catch (error) {
        console.error('[Auth Proxy] Error verifying session:', error)
    }

    if (isProtected && !userId) return redirectToLogin(request)

    if (isAuthPath && userId) {
        const url = request.nextUrl.clone()
        url.pathname = '/quizzes'
        url.search = ''
        return NextResponse.redirect(url)
    }

    // Must return supabaseResponse as-is to keep refreshed cookies in sync.
    return supabaseResponse
}

function redirectToLogin(request: NextRequest) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(url)
}

function clearAuthCookies(request: NextRequest, response: NextResponse) {
    request.cookies.getAll()
        .filter(c => c.name.startsWith('sb-'))
        .forEach(c => response.cookies.delete(c.name))
}
