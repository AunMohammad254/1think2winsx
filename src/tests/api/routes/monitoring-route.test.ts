// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/monitoring/route';

const DSN = 'https://key@o1.ingest.us.sentry.io/2';
const UPSTREAM = 'https://o1.ingest.us.sentry.io/api/2/envelope/';

/** A Sentry envelope: a JSON header line, then items (a replay item is binary, so the body is bytes). */
const envelope = (header: unknown, items: Uint8Array = new TextEncoder().encode('{"type":"event"}\n{}')) => {
  const head = new TextEncoder().encode(`${typeof header === 'string' ? header : JSON.stringify(header)}\n`);
  const body = new Uint8Array(head.length + items.length);
  body.set(head);
  body.set(items, head.length);
  return body;
};
const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  POST(new NextRequest('http://localhost/monitoring', { method: 'POST', body, headers }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', DSN);
  fetchMock = vi.fn(async () => new Response('{"id":"e1"}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /monitoring (Sentry tunnel)', () => {
  it("forwards this site's envelopes to Sentry unchanged, with the visitor's address", async () => {
    const binary = new Uint8Array([0x7b, 0x7d, 0x0a, 0x00, 0xff, 0x0a, 0x80]);
    const body = envelope({ dsn: DSN, sent_at: '2026-10-23T00:00:00Z' }, binary);
    const res = await post(body, { 'x-forwarded-for': '151.123.245.100' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"id":"e1"}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(UPSTREAM);
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Forwarded-For': '151.123.245.100' } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // The bytes go through as they came: a replay's compressed recording survives
    expect(Array.from(init.body as Uint8Array)).toEqual(Array.from(body));
  });

  it("passes Sentry's rate limits back so the browser SDK backs off, and sends no address it doesn't have", async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'X-Sentry-Rate-Limits': '60:error:organization', 'Retry-After': '60' } }));
    const res = await post(envelope({ dsn: DSN }));
    expect(res.status).toBe(429);
    expect(res.headers.get('x-sentry-rate-limits')).toBe('60:error:organization');
    expect(res.headers.get('retry-after')).toBe('60');
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Forwarded-For');
  });

  it("refuses envelopes for any other Sentry project or host, so it can't be used as an open relay", async () => {
    for (const dsn of ['https://key@o1.ingest.us.sentry.io/99', 'https://key@o7.ingest.de.sentry.io/2', 'not a url']) {
      const res = await post(envelope({ dsn }));
      expect(res.status).toBe(400);
    }
    // A header without a DSN, a header that isn't JSON, and an envelope that is only a header
    expect((await post(envelope({ event_id: 'e1' }))).status).toBe(400);
    expect((await post(envelope('not json'))).status).toBe(400);
    expect((await post(JSON.stringify({ dsn: 'https://key@o1.ingest.us.sentry.io/' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts an envelope that is only a header line', async () => {
    expect((await post(JSON.stringify({ dsn: DSN }))).status).toBe(200);
  });

  it('refuses an envelope larger than any real one', async () => {
    const res = await post(envelope({ dsn: DSN }, new Uint8Array(5_000_001)));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 502 when Sentry cannot be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('timed out'));
    const res = await post(envelope({ dsn: DSN }));
    expect(res.status).toBe(502);
    expect(warn).toHaveBeenCalledWith('[monitoring] Sentry could not be reached:', 'timed out');
  });

  it('answers 503 while Sentry is not set up (no DSN, or one without a project)', async () => {
    for (const dsn of ['', 'https://key@o1.ingest.us.sentry.io/', '::bad::']) {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn);
      expect((await post(envelope({ dsn: DSN }))).status).toBe(503);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
