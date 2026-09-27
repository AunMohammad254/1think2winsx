import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// NOTE: This file must live in `src/` (next to `app/`). The previous root-level
// `middleware.ts` was silently ignored by Next.js because the project uses `src/`,
// so none of the guards or security headers below were ever applied.

// Admin session cookie name (must match admin-session.ts)
const ADMIN_SESSION_COOKIE = 'admin-session';

const isDev = process.env.NODE_ENV === 'development';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseWs = supabaseUrl.replace(/^http/, 'ws');

// Built once per process instead of on every request.
// 'unsafe-inline' for scripts is required because Next.js App Router injects inline
// bootstrap scripts; a nonce-based CSP would force every page to render dynamically
// (no static HTML / CDN caching), which is the wrong trade-off for a 50k-user site.
const CSP = [
  "default-src 'self'",
  isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://accounts.google.com`,
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://www.facebook.com https://player.twitch.tv",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "media-src 'self' https:",
].join('; ');

function applySecurityHeaders(response: NextResponse) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.headers.set('Content-Security-Policy', CSP);
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Cheap cookie presence check for admin pages (full DB validation happens in the
  // (protected) admin layout and in every admin Server Action via assertAdmin()).
  const isAdminRoute = pathname.startsWith('/admin') && !pathname.startsWith('/admin/login');
  if (isAdminRoute && !request.cookies.get(ADMIN_SESSION_COOKIE)?.value) {
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Only touches Supabase Auth for protected/auth routes (see updateSession).
  const response = await updateSession(request);
  if (response.headers.get('location')) {
    return response;
  }
  return applySecurityHeaders(response);
}

export const config = {
  matcher: [
    /*
     * Skip API routes (they authenticate themselves), Next internals, and
     * static files in /public so the proxy never runs for assets.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest|Favicon|images|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|css|js|map|txt|xml|json|woff2?|ttf|glb|gltf|mp4|webm)$).*)',
  ],
};
