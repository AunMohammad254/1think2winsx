import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Admin session cookie name (must match admin-session.ts)
const ADMIN_SESSION_COOKIE = 'admin-session';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Create a new request with the pathname header for server components to read
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);

  // Check if this is an admin route (except admin login page and API routes)
  const isAdminRoute = pathname.startsWith('/admin') &&
    !pathname.startsWith('/admin/login') &&
    !pathname.startsWith('/api/');

  if (isAdminRoute) {
    // Check for admin session cookie
    const adminSession = request.cookies.get(ADMIN_SESSION_COOKIE);

    if (!adminSession?.value) {
      // Redirect to admin login
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Update Supabase session (refresh tokens, check auth for protected routes)
  // Pass the modified request with pathname header
  const supabaseResponse = await updateSession(request);

  // If Supabase middleware returned a redirect, use that
  if (supabaseResponse.headers.get('location')) {
    return supabaseResponse;
  }

  // Add security headers to the response
  const response = supabaseResponse;

  // Security Headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()');
  response.headers.set('X-DNS-Prefetch-Control', 'on');
  response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

  // Content Security Policy - More restrictive in production
  const isDev = process.env.NODE_ENV === 'development';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const csp = [
    "default-src 'self'",
    isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseUrl} https://accounts.google.com`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "media-src 'self'"
  ].join('; ');

  response.headers.set('Content-Security-Policy', csp);

  // HSTS (only in production)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Add pathname header so server components can access current route
  response.headers.set('x-pathname', pathname);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
