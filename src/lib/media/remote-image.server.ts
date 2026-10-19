/**
 * Downloads an image an admin pasted a link to, without letting the link reach this server's
 * own network: https only, every address the host resolves to must be public (checked again on
 * each redirect), a time limit, and a size cap read off the stream rather than trusted from the
 * headers. The bytes are still checked by sharp when they are stored.
 *
 * The host is resolved before the request and again by fetch, so a host that changes its DNS
 * answer in between is not stopped; the admin-only callers make that an accepted risk.
 */
import dns from 'node:dns';
import { isIP } from 'node:net';

/** Same cap as admin uploads to /api/upload. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export class RemoteImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteImageError';
  }
}

const ignore = () => undefined;

/** Lets go of a response body that will not be read. */
async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(ignore);
}

function isPublicIPv4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast/reserved
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF protocol, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false; // TEST-NET-2/3
  return true;
}

function isPublicIPv6(ip: string): boolean {
  const groups = ip.toLowerCase().split(':');
  const first = parseInt(groups[0] || '0', 16);
  // ::/8 holds the unspecified and loopback addresses and every IPv4-mapped/compatible form
  if (first === 0) return false;
  if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x64 && groups[1] === 'ff9b') return false; // NAT64 can map to private IPv4
  if (first === 0x2001 && groups[1] === 'db8') return false; // documentation
  return true;
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPublicIPv4(ip);
  if (version === 6) return isPublicIPv6(ip);
  return false;
}

async function checkUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteImageError('Enter the full image link, starting with https://');
  }
  if (url.protocol !== 'https:') throw new RemoteImageError('Only https:// image links can be imported');
  if (url.username || url.password || (url.port && url.port !== '443')) {
    throw new RemoteImageError('Image links cannot carry a login or a custom port');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      throw new RemoteImageError(`Could not find the website ${host}`);
    }
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new RemoteImageError('That link points to a private or local address');
  }
  return url;
}

async function readCapped(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(ignore);
      throw new RemoteImageError('The image is larger than 10 MB');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The image at a public https link, at most 10 MB. Throws RemoteImageError with a message for the admin. */
export async function fetchRemoteImage(
  link: string,
  { timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<Buffer> {
  const signal = AbortSignal.timeout(timeoutMs);
  let target = link;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await checkUrl(target);
    let res: Response;
    try {
      // Redirects are followed here, so every hop is checked like the first
      res = await fetch(url, { redirect: 'manual', signal, headers: { accept: 'image/*' } });
    } catch {
      throw new RemoteImageError(signal.aborted ? 'The image took too long to download' : 'Could not download the image');
    }

    if (res.status >= 300 && res.status < 400) {
      await discard(res);
      const location = res.headers.get('location');
      if (!location) throw new RemoteImageError('The image link redirects nowhere');
      target = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) {
      await discard(res);
      throw new RemoteImageError(`The image link answered ${res.status}`);
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) {
      await discard(res);
      throw new RemoteImageError('That link is not an image');
    }
    if (Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) {
      await discard(res);
      throw new RemoteImageError('The image is larger than 10 MB');
    }
    if (!res.body) throw new RemoteImageError('The image link sent no data');
    return readCapped(res.body);
  }
  throw new RemoteImageError('The image link redirects too many times');
}
