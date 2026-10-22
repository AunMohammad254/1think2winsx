import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { getEmailQuotaStatus } from '@/lib/email-quota';

/** Today's email count against the daily limit, for the admin newsletter screen. */
export async function GET(request: NextRequest) {
  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;

    const adminSession = await validateAdminSession();
    if (!adminSession.valid || !adminSession.email) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized. Admin session required.' },
        { status: 401 }
      );
    }

    const quota = await getEmailQuotaStatus();
    return createSecureJsonResponse({ success: true, quota }, { status: 200 });
  } catch (error) {
    console.error('Error in admin email quota endpoint:', error);
    return NextResponse.json(
      { success: false, message: 'Could not read the daily email count.' },
      { status: 500 }
    );
  }
}
