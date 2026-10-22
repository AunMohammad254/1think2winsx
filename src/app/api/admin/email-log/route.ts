import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateAdminSession } from '@/lib/admin-session';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { EMAIL_LOG_PAGE_SIZE, listEmailLog } from '@/lib/mail/admin';

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  q: z.string().max(200).optional(),
  provider: z.enum(['ses', 'brevo']).optional(),
  status: z.enum(['accepted', 'failed', 'delivered', 'bounced', 'complained']).optional(),
  kind: z.enum(['registration', 'newsletter_signup', 'newsletter', 'password', 'account', 'support']).optional(),
});

/** One page of the email log, newest first, with optional search and filters. */
export async function GET(request: NextRequest) {
  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;
    const adminSession = await validateAdminSession();
    if (!adminSession.valid || !adminSession.email) {
      return NextResponse.json({ success: false, message: 'Unauthorized. Admin session required.' }, { status: 401 });
    }

    const params = Object.fromEntries([...request.nextUrl.searchParams.entries()].filter(([, value]) => value !== ''));
    const parsed = QuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ success: false, message: 'Invalid filter.' }, { status: 400 });
    }

    const { entries, total } = await listEmailLog(parsed.data);
    return createSecureJsonResponse({ success: true, entries, total, page: parsed.data.page, pageSize: EMAIL_LOG_PAGE_SIZE }, { status: 200 });
  } catch (error) {
    console.error('Error in admin email log endpoint:', error);
    return NextResponse.json({ success: false, message: 'Could not load the email log.' }, { status: 500 });
  }
}
