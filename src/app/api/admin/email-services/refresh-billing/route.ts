import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { getAwsCost } from '@/lib/mail/status';

/** A new AWS cost lookup ($0.02), allowed once an hour; otherwise the cached result. */
export async function POST(request: NextRequest) {
  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;
    const adminSession = await validateAdminSession();
    if (!adminSession.valid || !adminSession.email) {
      return NextResponse.json({ success: false, message: 'Unauthorized. Admin session required.' }, { status: 401 });
    }

    const awsCost = await getAwsCost({ refresh: true });
    return createSecureJsonResponse({ success: true, awsCost }, { status: 200 });
  } catch (error) {
    console.error('Error refreshing AWS billing:', error);
    return NextResponse.json({ success: false, message: 'Could not refresh the AWS billing.' }, { status: 500 });
  }
}
