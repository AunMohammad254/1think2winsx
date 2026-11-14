import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CLOCK_SKEW_LIMIT_MS,
  classifyPageError,
  describeClockSkew,
  measureClockSkew,
  networkAwareMessage,
  turnstileMessage,
  turnstileProblem,
  type TurnstileProblem,
} from '@/lib/network-errors';

afterEach(() => vi.restoreAllMocks());

describe('measureClockSkew', () => {
  it('compares the server Date header with the midpoint of the request, positive when the device is behind', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(3_000);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { headers: { date: new Date(12 * 3_600_000).toUTCString() } }),
    );
    expect(await measureClockSkew()).toBe(12 * 3_600_000 - 2_000);
    expect(fetchMock).toHaveBeenCalledWith('/favicon.ico', { method: 'HEAD', cache: 'no-store' });
    expect(now).toHaveBeenCalledTimes(2);
  });

  it('gives null without a usable Date header or when the request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null));
    expect(await measureClockSkew('/x')).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await measureClockSkew()).toBeNull();
  });
});

describe('describeClockSkew', () => {
  it.each([
    [12 * 3_600_000, 'about 12 hours behind'],
    [-3 * 86_400_000, 'about 3 days ahead'],
    [95 * 60_000, 'about 2 hours behind'],
    [70 * 60_000, 'about an hour behind'],
    [-60_000, 'about 1 minute ahead'],
    [7 * 60_000, 'about 7 minutes behind'],
  ])('%d ms -> %s', (ms, text) => expect(describeClockSkew(ms)).toBe(text));
});

describe('turnstileProblem', () => {
  it.each([
    ['200100', 'clock'],
    ['110600', 'timeout'],
    ['110620', 'timeout'],
    ['200500', 'blocked'],
    ['110100', 'config'],
    ['110110', 'config'],
    ['110200', 'config'],
    ['400020', 'config'],
    ['400070', 'config'],
    ['300030', 'challenge'],
    ['600010', 'challenge'],
    ['999999', 'unknown'],
    [undefined, 'unknown'],
  ])('%s -> %s', (code, problem) => expect(turnstileProblem(code)).toBe(problem));
});

describe('turnstileMessage', () => {
  it('has advice for every problem', () => {
    const kinds: TurnstileProblem[] = ['offline', 'clock', 'blocked', 'config', 'timeout', 'challenge', 'unknown'];
    const messages = kinds.map((k) => turnstileMessage(k));
    expect(new Set(messages).size).toBe(kinds.length);
    expect(messages[0]).toMatch(/offline/);
    expect(messages[1]).toBe(`Your device's date or time is wrong. Turn on "Set time automatically" in your device settings, then tap Try again.`);
    expect(messages[2]).toMatch(/challenges\.cloudflare\.com/);
    expect(messages[6]).toMatch(/security check couldn.t finish/);
  });

  it('says how far off the clock is when it was measured', () => {
    expect(turnstileMessage('clock', 12 * 3_600_000)).toMatch(/wrong \(about 12 hours behind\)\./);
  });

  it('only calls a clock wrong past the limit Cloudflare tolerates', () => {
    expect(CLOCK_SKEW_LIMIT_MS).toBe(300_000);
  });
});

describe('classifyPageError', () => {
  it('blames the connection first when offline', () => {
    expect(classifyPageError(new Error('anything'), false)).toBe('offline');
  });

  it.each([
    [Object.assign(new Error('Loading chunk 123 failed.'), { name: 'ChunkLoadError' })],
    [new Error('Loading CSS chunk 7 failed')],
    [new TypeError('Failed to fetch dynamically imported module: /x.js')],
    [new TypeError('Importing a module script failed.')],
  ])('spots a file from an old deploy: %s', (error) => expect(classifyPageError(error, true)).toBe('update'));

  it.each([[new Error('db down')], ['a thrown string'], [null], [{ name: 1 }]])('treats anything else as generic: %s', (error) => {
    expect(classifyPageError(error, true)).toBe('generic');
  });
});

describe('networkAwareMessage', () => {
  it('keeps the fallback online and explains offline', () => {
    expect(networkAwareMessage('Login failed')).toBe('Login failed');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(networkAwareMessage('Login failed')).toMatch(/offline/);
  });
});
