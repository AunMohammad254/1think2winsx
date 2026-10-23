import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/client-ip';

/**
 * Sentry tunnel. Browsers post their Sentry events here (`tunnel` in src/instrumentation-client.ts)
 * and this forwards them to Sentry, so ad blockers don't drop them and the CSP needs no Sentry host.
 *
 * It replaces withSentryConfig's `tunnelRoute` rewrite: Next proxied that one with a stream pipe that
 * printed a MaxListenersExceededWarning for every event, and it relayed to any Sentry project named
 * in the query. This forwards only envelopes for this site's own DSN.
 */

/** Larger than any real envelope (a Session Replay segment is compressed); stops the tunnel being used to upload junk. */
const MAX_ENVELOPE_BYTES = 5_000_000;
const UPSTREAM_TIMEOUT_MS = 10_000;
/** Sentry's answers the browser SDK reads to back off when the project is over its quota. */
const PASSED_BACK_HEADERS = ['x-sentry-rate-limits', 'retry-after'];

/** The host and project of NEXT_PUBLIC_SENTRY_DSN (https://key@o1.ingest.us.sentry.io/2), or null when unset or malformed. */
function ownProject(dsn: string | undefined): { host: string; projectId: string } | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    return projectId ? { host: url.hostname, projectId } : null;
  } catch {
    return null;
  }
}

/** The DSN an envelope names in its header: the first line, a JSON object. */
function envelopeDsn(body: Uint8Array): string | null {
  const end = body.indexOf(0x0a);
  try {
    const header = JSON.parse(new TextDecoder().decode(end === -1 ? body : body.subarray(0, end)));
    return typeof header?.dsn === 'string' ? header.dsn : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const own = ownProject(process.env.NEXT_PUBLIC_SENTRY_DSN);
  if (!own) return NextResponse.json({ error: 'Sentry is not configured' }, { status: 503 });

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_ENVELOPE_BYTES) return NextResponse.json({ error: 'Envelope too large' }, { status: 413 });

  const named = ownProject(envelopeDsn(body) ?? undefined);
  if (!named || named.host !== own.host || named.projectId !== own.projectId) {
    return NextResponse.json({ error: "Not this site's Sentry project" }, { status: 400 });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/x-sentry-envelope' };
  // Sentry places the event by the visitor's address, not this server's
  const ip = getClientIp(request.headers);
  if (ip !== 'unknown') headers['X-Forwarded-For'] = ip;

  let upstream: Response;
  try {
    upstream = await fetch(`https://${own.host}/api/${own.projectId}/envelope/`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    console.warn('[monitoring] Sentry could not be reached:', (error as Error).message);
    return NextResponse.json({ error: 'Sentry could not be reached' }, { status: 502 });
  }

  const passedBack = new Headers();
  for (const name of PASSED_BACK_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) passedBack.set(name, value);
  }
  return new NextResponse(await upstream.text(), { status: upstream.status, headers: passedBack });
}
