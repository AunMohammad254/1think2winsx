import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';

/**
 * The checks an admin API route runs first: CSRF on writes, an admin session (player login or the
 * admin panel's own session) and the admin rate limit. Resolves to the admin, or to the response
 * that refused the request. (Server Actions use `adminActionGuard` in admin-guard.ts instead.)
 */
export async function adminApiGuard(
  request: NextRequest,
  endpoint: string,
  options: { write: boolean },
): Promise<Response | { id: string; email: string }> {
  if (options.write) {
    const csrf = await requireCSRFToken(request);
    if (csrf) return csrf;
  }
  const auth = await requireAuth({ adminOnly: true });
  if (auth instanceof NextResponse) return auth;
  const limited = await applyRateLimit(rateLimiters.admin, request, auth.session.user.id, endpoint);
  if (limited) return limited;
  return { id: auth.session.user.id, email: auth.session.user.email || auth.session.user.id };
}
