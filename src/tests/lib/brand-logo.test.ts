import { describe, it, expect, vi, afterEach } from 'vitest';
import { brandLogoDataUri, BRAND_LOGO_PNG } from '@/lib/brand-logo';
import { EMAIL_LOGO_PATH } from '@/lib/email-theme';

afterEach(() => vi.restoreAllMocks());

describe('brandLogoDataUri', () => {
  it('reads the brain mark from public/ as a PNG data URI', async () => {
    expect(await brandLogoDataUri()).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
  });

  it('gives null, and says why, when the file is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'cwd').mockReturnValue('/no-such-app');
    expect(await brandLogoDataUri()).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Not readable'), expect.anything());
  });

  it('is the same file the emails link to', () => {
    expect(EMAIL_LOGO_PATH).toBe(BRAND_LOGO_PNG);
  });
});
