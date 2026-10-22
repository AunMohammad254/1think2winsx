import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/supabase/db';
import { brevoEvent, tokenMatches } from '@/lib/mail/events';

/**
 * Brevo transactional webhook (delivered, hard_bounce, blocked, spam). Brevo doesn't sign webhooks,
 * so the webhook is created with a bearer token, BREVO_WEBHOOK_TOKEN, which every call must carry.
 * One event per call; a list is accepted too.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.BREVO_WEBHOOK_TOKEN?.trim();
  if (!expected) return NextResponse.json({ error: 'Brevo notices are not configured' }, { status: 503 });

  const presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!tokenMatches(presented, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const events = (Array.isArray(body) ? body : [body])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(brevoEvent)
    .filter((event) => event !== null);

  for (const event of events) {
    const { error } = await getAdminDb().rpc('record_email_event', {
      p_provider: 'brevo',
      p_message_id: event.messageId,
      p_status: event.status,
      p_error: event.reason,
    });
    if (error) {
      console.error('[webhooks/brevo] Could not record the notice:', error);
      return NextResponse.json({ error: 'Could not record the notice' }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, recorded: events.length });
}
