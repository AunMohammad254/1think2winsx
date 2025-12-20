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

    const {
        data: { user },
    } = await supabase.auth.getUser()

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
