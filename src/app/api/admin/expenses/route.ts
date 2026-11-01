import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';
import {
  getExpenseManagerData,
  groupExpensesBySubscription,
  calculateExpenseSummary,
  addExpenseItem,
  addSubscription,
  updateSubscription,
  updateExpenseSettings,
} from '@/lib/expenses/expense-service';
import { z } from 'zod';

const AddExpenseItemSchema = z.object({
  subscriptionId: z.string().min(1),
  title: z.string().min(1).max(150),
  type: z.enum(['charge', 'deduction']),
  amount: z.number().positive(),
  currency: z.enum(['USD', 'PKR']).default('USD'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum([
    'infrastructure',
    'database',
    'ai',
    'email',
    'media',
    'monitoring',
    'security',
    'domain',
    'other',
  ]),
  notes: z.string().max(500).optional(),
});

const AddSubscriptionSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.string().min(1).max(100),
  category: z.enum([
    'infrastructure',
    'database',
    'ai',
    'email',
    'media',
    'monitoring',
    'security',
    'domain',
    'other',
  ]),
  billingCycle: z.enum(['monthly', 'quarterly', 'annual']),
  nextBillingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['active', 'trial', 'canceling', 'paused']).default('active'),
  currency: z.enum(['USD', 'PKR']).default('USD'),
  autoRenew: z.boolean().default(true),
  paymentMethod: z.string().min(1).max(100),
  planName: z.string().min(1).max(100),
  portalUrl: z.string().url().optional().or(z.literal('')),
  description: z.string().max(500).optional(),
});

const UpdateSettingsSchema = z.object({
  defaultCurrency: z.enum(['USD', 'PKR']).optional(),
  alertThresholdUSD: z.number().positive().optional(),
  enableRenewalReminders: z.boolean().optional(),
  exchangeRateUsdToPkr: z.number().positive().optional(),
});

/**
 * GET /api/admin/expenses
 * Returns all active subscriptions, grouped upcoming cycle expenses, summary, and settings.
 * Accessible strictly to verified admins.
 */
export async function GET() {
  try {
    const adminSession = await validateAdminSession();
    if (!adminSession.valid || !adminSession.email) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Admin session required.' },
        { status: 401 }
      );
    }

    const data = await getExpenseManagerData();
    const grouped = groupExpensesBySubscription(data.subscriptions, data.expenses);
    const summary = calculateExpenseSummary(grouped, data.settings.exchangeRateUsdToPkr);

    return createSecureJsonResponse(
      {
        success: true,
        summary,
        groupedExpenses: grouped,
        subscriptions: data.subscriptions,
        expenses: data.expenses,
        settings: data.settings,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[admin/expenses] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve expenses' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/expenses
 * Adds a new expense item (charge or deduction) or a new subscription.
 * Body shape:
 * - { entity: 'expense_item', data: AddExpenseItemSchema }
 * - { entity: 'subscription', data: AddSubscriptionSchema }
 */
export async function POST(request: NextRequest) {
  try {
    const csrfCheck = await requireCSRFToken(request);
    if (csrfCheck) return csrfCheck;

    const adminSession = await validateAdminSession();
    if (!adminSession.valid || !adminSession.email) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Admin session required.' },
        { status: 401 }
      );
    }

    const body = await request.json();

    if (body.entity === 'expense_item') {
      const parsed = AddExpenseItemSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: 'Invalid expense item payload', details: parsed.error.issues },
          { status: 400 }
        );
      }

      const item = await addExpenseItem(parsed.data, adminSession.email);
      return createSecureJsonResponse({ success: true, item }, { status: 201 });
    }

    if (body.entity === 'subscription') {
      const parsed = AddSubscriptionSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: 'Invalid subscription payload', details: parsed.error.issues },
          { status: 400 }
        );
      }

      const subscription = await addSubscription(parsed.data, adminSession.email);
      return createSecureJsonResponse({ success: true, subscription }, { status: 201 });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid entity type. Use expense_item or subscription.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[admin/expenses] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create expense entry' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/expenses
 * Updates subscription details or expense configuration settings.
 */
export async function PUT(request: NextRequest) {
  try {
    const csrfCheck = await requireCSRFToken(request);
    if (csrfCheck) return csrfCheck;

    const adminSession = await validateAdminSession();
    if (!adminSession.valid || !adminSession.email) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Admin session required.' },
        { status: 401 }
      );
    }

    const body = await request.json();

    if (body.entity === 'settings') {
      const parsed = UpdateSettingsSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: 'Invalid settings payload', details: parsed.error.issues },
          { status: 400 }
        );
      }

      const updatedSettings = await updateExpenseSettings(parsed.data, adminSession.email);
      return createSecureJsonResponse({ success: true, settings: updatedSettings }, { status: 200 });
    }

    if (body.entity === 'subscription' && body.id) {
      const updated = await updateSubscription(body.id, body.data, adminSession.email);
      if (!updated) {
        return NextResponse.json(
          { success: false, error: 'Subscription not found' },
          { status: 404 }
        );
      }
      return createSecureJsonResponse({ success: true, subscription: updated }, { status: 200 });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid update request' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[admin/expenses] PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update expense entry' },
      { status: 500 }
    );
  }
}

