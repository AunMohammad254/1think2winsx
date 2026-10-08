/**
 * Build the `Cookie` header the app expects from a Supabase password-grant session.
 *
 * The app authenticates API calls from cookies written by @supabase/ssr:
 *   name   sb-<project-ref>-auth-token   (split into `.0`, `.1`, ... chunks when long)
 *   value  "base64-" + base64url(JSON session)
 * Using the library's own helpers keeps the load test byte-compatible with real browsers.
 */
import { createChunks, stringToBase64URL } from '@supabase/ssr';

export interface SessionLike {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in?: number;
  expires_at?: number;
  user: unknown;
}

/** `https://abcd1234.supabase.co` -> `abcd1234` (what @supabase/ssr uses in the cookie name). */
export function projectRefFromUrl(supabaseUrl: string): string {
  return new URL(supabaseUrl).hostname.split('.')[0];
}

export function sessionCookieName(projectRef: string): string {
  return `sb-${projectRef}-auth-token`;
}

export function buildSessionCookieHeader(projectRef: string, session: SessionLike): string {
  const value = 'base64-' + stringToBase64URL(JSON.stringify(session));
  return createChunks(sessionCookieName(projectRef), value)
    .map((chunk) => `${chunk.name}=${chunk.value}`)
    .join('; ');
}
