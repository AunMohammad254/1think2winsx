import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = searchParams.get('next') ?? '/quizzes'

    if (code) {
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

    // Return the user to an error page with instructions
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
