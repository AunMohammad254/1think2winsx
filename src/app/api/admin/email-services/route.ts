import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateAdminSession } from '@/lib/admin-session';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { EmailServicesError, getEmailServicesOverview, updateEmailServices } from '@/lib/mail/admin';

const unauthorized = () => NextResponse.json({ success: false, message: 'Unauthorized. Admin session required.' }, { status: 401 });

/** The admin Email services page: selected service, counts, alerts and billing. */
export async function GET(request: NextRequest) {
  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;
    const adminSession = await validateAdminSession();
    if (!adminSession.valid || !adminSession.email) return unauthorized();

    const overview = await getEmailServicesOverview();
    return createSecureJsonResponse({ success: true, overview }, { status: 200 });
  } catch (error) {
    console.error('Error in admin email services endpoint:', error);
    return NextResponse.json({ success: false, message: 'Could not load the email services.' }, { status: 500 });
  }
}

const ChangeSchema = z
  .object({
    provider: z.enum(['ses', 'brevo']).optional(),
    sesDailyLimit: z.number().int().min(1).max(10_000_000).optional(),
  })
  .refine((change) => change.provider !== undefined || change.sesDailyLimit !== undefined, 'Nothing to change.');

/** An admin switches the service (Brevo or Amazon SES) or sets the SES daily limit. */
export async function PUT(request: NextRequest) {
  try {
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;
    const adminSession = await validateAdminSession();
    if (!adminSession.valid || !adminSession.email) return unauthorized();

    const parsed = ChangeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, message: parsed.error.issues[0].message }, { status: 400 });
    }

    await updateEmailServices(parsed.data, adminSession.email);
    return createSecureJsonResponse({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof EmailServicesError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    }
    console.error('Error saving the email services settings:', error);
    return NextResponse.json({ success: false, message: 'Could not save the change.' }, { status: 500 });
  }
}
