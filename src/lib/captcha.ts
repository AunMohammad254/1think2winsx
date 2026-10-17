/**
 * Supabase Auth has CAPTCHA protection on: sign-in, sign-up and password-reset requests must carry a
 * Cloudflare Turnstile token (`captchaToken`), which Supabase checks against the widget's secret.
 * Each token works for one request only.
 */

export const CAPTCHA_REQUIRED_MESSAGE = 'Please complete the security check.';
export const CAPTCHA_FAILED_MESSAGE = 'The security check failed or expired. Please try again.';

/** True when Supabase refused a request because its CAPTCHA token was missing, invalid or already used */
export function isCaptchaError(error: { code?: string; message?: string } | null): boolean {
    return !!error && (error.code === 'captcha_failed' || /captcha/i.test(error.message ?? ''));
}
