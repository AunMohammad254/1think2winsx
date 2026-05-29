import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { notificationDb } from '@/lib/supabase/db';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';

export async function POST(request: NextRequest) {
  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;

    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    const rateLimitResponse = await applyRateLimit(
      rateLimiters.general,
      request,
      userId,
      '/api/notifications/subscribe'
    );
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const subscription = body.subscription || body;

    const endpoint = subscription.endpoint;
    const p256dh = subscription.p256dh || (subscription.keys && subscription.keys.p256dh);
    const authKey = subscription.auth || (subscription.keys && subscription.keys.auth);

    if (!endpoint || !p256dh || !authKey) {
      return NextResponse.json(
        { message: 'Invalid subscription payload. Required fields: endpoint, keys (p256dh, auth).' },
        { status: 400 }
      );
    }

    await notificationDb.savePushSubscription(userId, {
      endpoint,
      keys: { p256dh, auth: authKey }
    });

    return createSecureJsonResponse({
      success: true,
      message: 'Subscription saved successfully'
    }, { status: 200 });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;

    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    const rateLimitResponse = await applyRateLimit(
      rateLimiters.general,
      request,
      userId,
      '/api/notifications/unsubscribe'
    );
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json(
        { message: 'Missing endpoint' },
        { status: 400 }
      );
    }

    await notificationDb.deletePushSubscription(userId, endpoint);

    return createSecureJsonResponse({
      success: true,
      message: 'Subscription removed successfully'
    }, { status: 200 });
  } catch (error) {
    console.error('Error deleting push subscription:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
