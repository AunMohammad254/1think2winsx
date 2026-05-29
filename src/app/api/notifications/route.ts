import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { notificationDb } from '@/lib/supabase/db';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';

// GET /api/notifications - Get list of notifications and unread count
export async function GET() {
  try {
    const session = await auth();

    if (!session || !session.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Fetch user notifications and count
    const [notifications, unreadCount] = await Promise.all([
      notificationDb.getUserNotifications(userId),
      notificationDb.getUnreadCount(userId),
    ]);

    return createSecureJsonResponse({
      success: true,
      notifications,
      unreadCount,
    }, { status: 200 });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/notifications - Mark notifications as read
export async function PUT(request: NextRequest) {
  try {
    // CSRF protection
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

    // Apply rate limit
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.general,
      request,
      userId,
      '/api/notifications'
    );
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const { notificationId, all } = body;

    if (all) {
      await notificationDb.markAllAsRead(userId);
    } else if (notificationId) {
      await notificationDb.markAsRead(notificationId, userId);
    } else {
      return NextResponse.json(
        { message: 'Invalid payload' },
        { status: 400 }
      );
    }

    return createSecureJsonResponse({
      success: true,
      message: all ? 'All notifications marked as read' : 'Notification marked as read',
    }, { status: 200 });
  } catch (error) {
    console.error('Error updating notification status:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/notifications - Delete a single notification or clear all
export async function DELETE(request: NextRequest) {
  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;

    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    const rateLimitResponse = await applyRateLimit(
      rateLimiters.general,
      request,
      userId,
      '/api/notifications'
    );
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const { notificationId, all } = body;

    if (all) {
      await notificationDb.deleteAllNotifications(userId);
    } else if (notificationId) {
      await notificationDb.deleteNotification(notificationId, userId);
    } else {
      return NextResponse.json({ message: 'Invalid payload' }, { status: 400 });
    }

    return createSecureJsonResponse({
      success: true,
      message: all ? 'All notifications cleared' : 'Notification deleted',
    }, { status: 200 });
  } catch (error) {
    console.error('Error deleting notification:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
