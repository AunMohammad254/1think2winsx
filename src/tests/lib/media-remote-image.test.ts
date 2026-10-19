// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import dns from 'node:dns';

const lookup = vi.spyOn(dns.promises, 'lookup') as unknown as ReturnType<typeof vi.fn>;

const { fetchRemoteImage, isPublicAddress, MAX_IMAGE_BYTES, RemoteImageError } = await import('@/lib/media/remote-image.server');

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const png = (body: BodyInit | null = new Uint8Array([1, 2, 3]), headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'image/png', ...headers } });
const redirect = (location?: string) =>
  new Response(null, { status: 302, headers: location ? { location } : {} });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  lookup.mockReset().mockResolvedValue(PUBLIC);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const fails = (link: string, message: string | RegExp) =>
  expect(fetchRemoteImage(link)).rejects.toThrow(message);

describe('isPublicAddress', () => {
  it('accepts routable addresses and refuses private, local and reserved ones', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '192.0.1.1', '2606:4700::1111']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
    for (const ip of [
      '0.0.0.0', '10.1.2.3', '127.0.0.1', '224.0.0.1', '255.255.255.255', '100.64.0.1', '169.254.169.254',
      '172.16.0.1', '192.168.1.1', '192.0.0.8', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9',
      '::', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1', '2001:db8::1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});

describe('fetchRemoteImage', () => {
  it('downloads an image from a public https link', async () => {
    fetchMock.mockResolvedValue(png());
    expect(await fetchRemoteImage('https://images.example.com/a.png')).toEqual(Buffer.from([1, 2, 3]));
    expect(lookup).toHaveBeenCalledWith('images.example.com', { all: true, verbatim: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://images.example.com/a.png');
    expect(init).toMatchObject({ redirect: 'manual', headers: { accept: 'image/*' } });
  });

  it('refuses links that are not plain public https', async () => {
    await fails('not a link', 'Enter the full image link, starting with https://');
    await fails('http://images.example.com/a.png', 'Only https:// image links can be imported');
    await fails('https://user:pw@images.example.com/a.png', 'Image links cannot carry a login or a custom port');
    await fails('https://images.example.com:8443/a.png', 'Image links cannot carry a login or a custom port');
    await fails('https://127.0.0.1/a.png', 'That link points to a private or local address');
    await fails('https://[::1]/a.png', 'That link points to a private or local address');
    lookup.mockResolvedValueOnce([{ address: '93.184.216.34' }, { address: '10.0.0.5' }]);
    await fails('https://mixed.example.com/a.png', 'That link points to a private or local address');
    lookup.mockResolvedValueOnce([]);
    await fails('https://empty.example.com/a.png', 'That link points to a private or local address');
    lookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await fails('https://nowhere.example/a.png', 'Could not find the website nowhere.example');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the default https port and public IP literals', async () => {
    fetchMock.mockImplementation(async () => png());
    await fetchRemoteImage('https://images.example.com:443/a.png');
    await fetchRemoteImage('https://93.184.216.34/a.png');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('follows up to three redirects, checking each hop', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('/b.png'))
      .mockResolvedValueOnce(redirect('https://cdn.example.net/c.png'))
      .mockResolvedValueOnce(png());
    expect(await fetchRemoteImage('https://images.example.com/a.png')).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      'https://images.example.com/a.png',
      'https://images.example.com/b.png',
      'https://cdn.example.net/c.png',
    ]);

    fetchMock.mockReset().mockResolvedValueOnce(redirect('https://169.254.169.254/latest/meta-data'));
    await fails('https://images.example.com/a.png', 'That link points to a private or local address');

    fetchMock.mockReset().mockResolvedValue(redirect('/again'));
    await fails('https://images.example.com/a.png', 'The image link redirects too many times');
    expect(fetchMock).toHaveBeenCalledTimes(4);

    fetchMock.mockReset().mockResolvedValue(redirect());
    await fails('https://images.example.com/a.png', 'The image link redirects nowhere');
  });

  it('refuses error answers, other content and files over 10 MB', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    await fails('https://images.example.com/a.png', 'The image link answered 404');
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    await fails('https://images.example.com/a.png', 'That link is not an image');
    // A byte body sets no content type of its own
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    await fails('https://images.example.com/a.png', 'That link is not an image');
    fetchMock.mockResolvedValueOnce(png('x', { 'content-length': String(MAX_IMAGE_BYTES + 1) }));
    await fails('https://images.example.com/a.png', 'The image is larger than 10 MB');
    fetchMock.mockResolvedValueOnce(png(null));
    await fails('https://images.example.com/a.png', 'The image link sent no data');

    // A size the headers don't declare is counted while reading
    const big = new Uint8Array(MAX_IMAGE_BYTES / 2 + 1);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(big);
      },
    });
    fetchMock.mockResolvedValueOnce(png(stream));
    await fails('https://images.example.com/a.png', 'The image is larger than 10 MB');
  });

  it('lets go of unread bodies even when cancelling them fails', async () => {
    const res = new Response('nope', { status: 500 });
    vi.spyOn(res.body!, 'cancel').mockRejectedValue(new Error('already closed'));
    fetchMock.mockResolvedValueOnce(res);
    await fails('https://images.example.com/a.png', 'The image link answered 500');

    const reader = { read: vi.fn().mockResolvedValue({ done: false, value: new Uint8Array(MAX_IMAGE_BYTES + 1) }), cancel: vi.fn().mockRejectedValue(new Error('closed')) };
    const body = { getReader: () => reader, cancel: vi.fn() } as unknown as ReadableStream<Uint8Array>;
    fetchMock.mockResolvedValueOnce({ status: 200, ok: true, headers: new Headers({ 'content-type': 'image/png' }), body });
    await fails('https://images.example.com/a.png', 'The image is larger than 10 MB');
    expect(reader.cancel).toHaveBeenCalled();
  });

  it('reports network failures and slow downloads', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const err = await fetchRemoteImage('https://images.example.com/a.png').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteImageError);
    expect((err as Error).message).toBe('Could not download the image');

    fetchMock.mockImplementationOnce((_url: unknown, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
    await expect(fetchRemoteImage('https://images.example.com/a.png', { timeoutMs: 5 })).rejects.toThrow(
      'The image took too long to download',
    );
  });
});
