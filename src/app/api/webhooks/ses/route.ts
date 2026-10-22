import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/supabase/db';
import { fetchSnsCertificate, isSnsUrl, sesEvent, verifySnsMessage, type SnsMessage } from '@/lib/mail/events';

/**
 * Amazon SES delivery, bounce and complaint notices, through the SNS topic named in
 * AWS_SES_SNS_TOPIC_ARN (SES > Identities > 1think2win.com > Notifications). Every message must be
 * signed by AWS and come from that topic. The topic's first message asks to confirm the
 * subscription, which is done here.
 *
 * SNS retries a 5xx, so a database error answers 500; anything we never want again answers 4xx or 200.
 */
export async function POST(request: NextRequest) {
  const topicArn = process.env.AWS_SES_SNS_TOPIC_ARN?.trim();
  if (!topicArn) return NextResponse.json({ error: 'SES notices are not configured' }, { status: 503 });

  let message: SnsMessage;
  try {
    message = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (message?.TopicArn !== topicArn) return NextResponse.json({ error: 'Unknown topic' }, { status: 403 });

  try {
    if (!(await verifySnsMessage(message, fetchSnsCertificate))) return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  } catch (error) {
    console.error('[webhooks/ses] Could not check the signature:', error);
    return NextResponse.json({ error: 'Could not check the signature' }, { status: 500 });
  }

  if (message.Type === 'SubscriptionConfirmation') {
    if (!isSnsUrl(message.SubscribeURL)) return NextResponse.json({ error: 'Invalid SubscribeURL' }, { status: 400 });
    const confirmed = await fetch(message.SubscribeURL!, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!confirmed?.ok) return NextResponse.json({ error: 'Could not confirm the subscription' }, { status: 500 });
    return NextResponse.json({ confirmed: true });
  }
  if (message.Type !== 'Notification') return NextResponse.json({ ok: true });

  const event = sesEvent(message.Message);
  if (!event) return NextResponse.json({ ok: true, ignored: true });

  const { error } = await getAdminDb().rpc('record_email_event', {
    p_provider: 'ses',
    p_message_id: event.messageId,
    p_status: event.status,
    p_error: event.reason,
  });
  if (error) {
    console.error('[webhooks/ses] Could not record the notice:', error);
    return NextResponse.json({ error: 'Could not record the notice' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
