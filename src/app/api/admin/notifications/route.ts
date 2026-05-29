import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { notificationDb, userDb, getAdminDb } from '@/lib/supabase/db';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';

// GET /api/admin/notifications - Fetch notification history (all users, paginated)
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession();
    if (!session.valid) {
      return NextResponse.json({ message: 'Unauthorized. Admin privileges required.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit') || '50'), 100);
    const offset = Number(searchParams.get('offset') || '0');

    const adminDb = getAdminDb();

    const { data, error, count } = await adminDb
      .from('Notification')
      .select(
        `id, userId, title, message, type, read, link, createdAt,
         User:userId (name, email)`,
        { count: 'exact' }
      )
      .order('createdAt', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return createSecureJsonResponse({
      success: true,
      notifications: data || [],
      total: count || 0,
      limit,
      offset,
    }, { status: 200 });
  } catch (error) {
    console.error('Error fetching admin notification history:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}



// POST /api/admin/notifications - Send notification (broadcast or targeted user)
export async function POST(request: NextRequest) {
  try {
    // CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;

    // Validate admin session
    const session = await validateAdminSession();
    if (!session.valid) {
      return NextResponse.json(
        { message: 'Unauthorized. Admin privileges required.' },
        { status: 401 }
      );
    }

    // Apply rate limit for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.email,
      '/api/admin/notifications'
    );
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const { title, message, type, link, targetType, targetEmail, scheduledAt } = body;

    if (!title || !message || !type) {
      return NextResponse.json(
        { message: 'Missing required fields: title, message, type are required' },
        { status: 400 }
      );
    }

    // Validate scheduledAt if present
    if (scheduledAt) {
      const scheduledDate = new Date(scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        return NextResponse.json(
          { message: 'Invalid scheduled date/time' },
          { status: 400 }
        );
      }
      if (scheduledDate <= new Date()) {
        return NextResponse.json(
          { message: 'Scheduled time must be in the future' },
          { status: 400 }
        );
      }
    }

    if (targetType === 'user') {
      if (!targetEmail) {
        return NextResponse.json(
          { message: 'Target email is required for user-specific notifications' },
          { status: 400 }
        );
      }

      // Find user by email
      const user = await userDb.findByEmail(targetEmail);
      if (!user) {
        return NextResponse.json(
          { message: `User with email ${targetEmail} not found` },
          { status: 404 }
        );
      }

      if (scheduledAt) {
        // Schedule targeted notification
        await notificationDb.scheduleNotification({
          title,
          message,
          type,
          link,
          targetType: 'user',
          targetUserId: user.id,
          scheduledAt,
        });

        return createSecureJsonResponse({
          success: true,
          message: `Notification successfully scheduled for ${targetEmail} at ${new Date(scheduledAt).toLocaleString()}`,
        }, { status: 200 });
      } else {
        // Create targeted notification immediately
        await notificationDb.create(user.id, {
          title,
          message,
          type,
          link,
        });

        return createSecureJsonResponse({
          success: true,
          message: `Notification sent successfully to ${targetEmail}`,
        }, { status: 200 });
      }
    } else {
      if (scheduledAt) {
        // Schedule broadcast notification
        await notificationDb.scheduleNotification({
          title,
          message,
          type,
          link,
          targetType: 'broadcast',
          scheduledAt,
        });

        return createSecureJsonResponse({
          success: true,
          message: `Broadcast notification successfully scheduled at ${new Date(scheduledAt).toLocaleString()}`,
        }, { status: 200 });
      } else {
        // Default: Broadcast to all users immediately
        await notificationDb.createBroadcast({
          title,
          message,
          type,
          link,
        });

        return createSecureJsonResponse({
          success: true,
          message: 'Broadcast notification sent successfully to all users',
        }, { status: 200 });
      }
    }
  } catch (error) {
    console.error('Error sending admin notification:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
