import { describe, it, expect, vi } from 'vitest';
import { isStaleAuthTokenError, setupStaleAuthWarningFilter } from '@/lib/supabase/auth-error-filter';

describe('auth-error-filter', () => {
  it('identifies various stale refresh token error representations', () => {
    expect(isStaleAuthTokenError(null)).toBe(false);
    expect(isStaleAuthTokenError(undefined)).toBe(false);
    expect(isStaleAuthTokenError('error')).toBe(false);

    expect(isStaleAuthTokenError({ code: 'refresh_token_not_found' })).toBe(true);
    expect(isStaleAuthTokenError({ code: 'refresh_token_already_used' })).toBe(true);
    expect(isStaleAuthTokenError({ code: 'session_expired' })).toBe(true);
    expect(isStaleAuthTokenError({ code: 'validation_failed' })).toBe(true);

    expect(isStaleAuthTokenError({ message: 'Invalid Refresh Token: Refresh Token Not Found' })).toBe(true);
    expect(isStaleAuthTokenError({ message: 'Invalid Refresh Token: Already Used' })).toBe(true);
    expect(isStaleAuthTokenError({ message: 'Refresh token is not valid' })).toBe(true);

    // Generic unrelated errors should not be identified as stale auth token errors
    expect(isStaleAuthTokenError({ message: 'Network connection failed' })).toBe(false);
    expect(isStaleAuthTokenError({ code: 'rate_limited' })).toBe(false);
  });

  it('filters out stale auth warnings from console.warn and console.error', () => {
    const warnSpy = vi.fn();
    const errorSpy = vi.fn();
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = warnSpy;
    console.error = errorSpy;

    // Reset filter singleton for test
    delete (globalThis as Record<string, unknown>).__staleAuthFilterInstalled;
    setupStaleAuthWarningFilter();

    console.warn({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' });
    expect(warnSpy).not.toHaveBeenCalled();

    console.error({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' });
    expect(errorSpy).not.toHaveBeenCalled();

    console.warn('Legitimate warning');
    expect(warnSpy).toHaveBeenCalledWith('Legitimate warning');

    console.error('Legitimate error');
    expect(errorSpy).toHaveBeenCalledWith('Legitimate error');

    console.warn = origWarn;
    console.error = origError;
  });
});
