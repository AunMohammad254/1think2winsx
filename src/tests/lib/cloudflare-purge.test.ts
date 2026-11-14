// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { purgeCloudflareCache } from '@/lib/cloudflare-purge';

const creds = { CLOUDFLARE_ZONE_ID: ' zone1 ', CLOUDFLARE_API_TOKEN: ' tok ' };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('purgeCloudflareCache', () => {
  it('skips without a zone and token', async () => {
    expect(await purgeCloudflareCache({})).toBe('skipped');
    expect(await purgeCloudflareCache({ CLOUDFLARE_ZONE_ID: 'z', CLOUDFLARE_API_TOKEN: '  ' })).toBe('skipped');
    vi.stubEnv('CLOUDFLARE_ZONE_ID', '');
    expect(await purgeCloudflareCache()).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('purges everything in the zone', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true }));
    expect(await purgeCloudflareCache(creds)).toBe('purged');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/zones/zone1/purge_cache');
    expect(init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer tok' }, body: '{"purge_everything":true}' });
  });

  it('reports a refusal, an unreadable answer and a network failure', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 }));
    expect(await purgeCloudflareCache(creds)).toBe('failed');
    expect(console.error).toHaveBeenCalledWith('[cloudflare-purge] Purge refused:', 403, '{"success":false,"errors":[{"code":10000}]}');

    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 502 }));
    expect(await purgeCloudflareCache(creds)).toBe('failed');

    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await purgeCloudflareCache(creds)).toBe('failed');
  });
});
