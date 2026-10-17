// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isCaptchaError } from '@/lib/captcha';

describe('isCaptchaError', () => {
  it("recognises Supabase's captcha_failed code or a CAPTCHA message", () => {
    expect(isCaptchaError({ code: 'captcha_failed' })).toBe(true);
    expect(isCaptchaError({ message: 'captcha protection: request disallowed (no captcha_token found)' })).toBe(true);
    expect(isCaptchaError({ message: 'CAPTCHA verification process failed' })).toBe(true);
  });

  it('leaves other errors and no error alone', () => {
    expect(isCaptchaError({ message: 'Invalid login credentials', code: 'invalid_credentials' })).toBe(false);
    expect(isCaptchaError({})).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
  });
});
