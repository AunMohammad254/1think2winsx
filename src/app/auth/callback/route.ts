import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    // Only allow same-site paths: `next` is appended to the host, so values like
    // "@evil.com" or "//evil.com" would otherwise redirect to another site.
    const rawNext = searchParams.get('next') ?? '/quizzes'
    const next = rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('\\')
        ? rawNext
        : '/quizzes'

    // Supabase reports a bad link by redirecting here with ?error=...&error_code=... and no code
    // (for example "otp_expired": the link was already used, replaced by a newer email, or timed out).
    const supabaseError = searchParams.get('error_code') || searchParams.get('error')

    if (code && !supabaseError) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)

        if (!error) {
            const forwardedHost = request.headers.get('x-forwarded-host')
            // Trust the proxy's own scheme (nginx sends X-Forwarded-Proto) instead of
            // assuming https. Assuming https broke self-hosted/local deployments behind
            // deploy/nginx.conf, which only listens on plain HTTP (port 80, no TLS
            // block) - the redirect went to https://<host>, which nothing was listening
            // on, and the browser hung/failed instead of completing sign-in.
            const forwardedProto = request.headers.get('x-forwarded-proto')
            const isLocalEnv = process.env.NODE_ENV === 'development'

            if (isLocalEnv) {
                return NextResponse.redirect(`${origin}${next}`)
            } else if (forwardedHost) {
                return NextResponse.redirect(`${forwardedProto || 'https'}://${forwardedHost}${next}`)
            } else {
                return NextResponse.redirect(`${origin}${next}`)
            }
        }
    }

    // The link did not work. Password setup/reset links work only once and only the newest email is
    // valid, so send those people somewhere that explains it and lets them request a fresh link.
    // (Sending them to /login hid the problem: that page drops the error and just shows a login form.)
    if (next === '/update-password') {
        return NextResponse.redirect(`${origin}/forgot-password?error=link_expired`)
    }

    // Any other sign-in link (e.g. email verification, Google): show the message on the login page.
    return NextResponse.redirect(`${origin}/auth?mode=login&error=auth_callback_error`)
}
