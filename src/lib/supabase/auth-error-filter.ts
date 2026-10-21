/**
 * Detects whether an error is a benign stale/revoked refresh token error.
 * These errors occur routinely when a visitor's cookie session has expired,
 * been revoked, or when switching between development and production databases.
 */
export function isStaleAuthTokenError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const errorObj = err as Record<string, unknown>;
    const code = errorObj.code || errorObj.error_code;
    const msg = String(errorObj.message || '');
    if (
      code === 'refresh_token_not_found' ||
      code === 'refresh_token_already_used' ||
      code === 'session_expired' ||
      code === 'validation_failed'
    ) {
      return true;
    }
    if (/refresh token/i.test(msg) || /invalid.*token/i.test(msg)) {
      return true;
    }
  }
  return false;
}

const globalState = globalThis as typeof globalThis & { __staleAuthFilterInstalled?: boolean };

/**
 * Suppresses noisy internal GoTrueClient warnings/errors in the server console
 * when visitors have expired or rotated refresh tokens in SSR cookies.
 * The middleware already clears stale cookies automatically.
 */
export function setupStaleAuthWarningFilter() {
  if (globalState.__staleAuthFilterInstalled) return;
  globalState.__staleAuthFilterInstalled = true;

  const origWarn = console.warn;
  const origError = console.error;

  console.warn = (...args: unknown[]) => {
    if (args.some(isStaleAuthTokenError)) return;
    origWarn.apply(console, args as [unknown, ...unknown[]]);
  };

  console.error = (...args: unknown[]) => {
    if (args.some(isStaleAuthTokenError)) return;
    origError.apply(console, args as [unknown, ...unknown[]]);
  };
}
