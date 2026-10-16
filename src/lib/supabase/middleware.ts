import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that require a signed-in user.
const PROTECTED_PREFIXES = ['/profile', '/quiz', '/quizzes']
// Signed-in users are bounced away from these.
const AUTH_PATHS = new Set(['/login', '/register'])

function hasSupabaseAuthCookie(request: NextRequest) {
    return request.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('-auth-token'))
}

// auth-js refreshes a session this close to expiry (EXPIRY_MARGIN_MS)
const REFRESH_MARGIN_S = 90

/**
 * True when the session cookie is expired/expiring (or unreadable), i.e. when the next
 * Supabase call would try to use the refresh token. Read locally — no network.
 * Cookie format (@supabase/ssr): "base64-" + base64url(JSON session), possibly split
 * into `<name>.0`, `<name>.1`, ... chunks.
 */
function authSessionNeedsRefresh(request: NextRequest): boolean {
    const cookies = request.cookies.getAll().filter(c => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    if (cookies.length === 0) return false
    const base = cookies[0].name.replace(/\.\d+$/, '')
    const whole = request.cookies.get(base)?.value
    const raw = whole ?? cookies
        .filter(c => c.name.startsWith(base + '.'))
        .sort((a, b) => Number(a.name.slice(base.length + 1)) - Number(b.name.slice(base.length + 1)))
        .map(c => c.value)
        .join('')
    try {
        const json = raw.startsWith('base64-')
            ? Buffer.from(raw.slice('base64-'.length), 'base64url').toString('utf8')
            : raw
        const expiresAt = Number(JSON.parse(json)?.expires_at)
        if (!Number.isFinite(expiresAt)) return true
        return expiresAt - Math.floor(Date.now() / 1000) <= REFRESH_MARGIN_S
    } catch {
        return true
    }
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

    // Public pages normally skip Supabase. But when the session cookie has expired, the
    // page's own API calls would each retry the refresh token — and log
    // "Invalid Refresh Token" forever if it's dead. Refresh (or clear) it once here instead.
    if (!isProtected && !isAuthPath && !authSessionNeedsRefresh(request)) {
        return supabaseResponse
    }

    if (!hasSupabaseAuthCookie(request)) {
        if (isProtected) return redirectToLogin(request)
        return supabaseResponse
    }

    // NOTE: deliberately no fetch timeout on this client (unlike the API-route clients). A
    // timeout here would surface as "no user" and bounce signed-in users to /login during a
    // Supabase slowdown; waiting is the safer failure mode for page navigations.
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
