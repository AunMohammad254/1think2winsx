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
  updateExpenseItem,
  deleteSubscription,
  deleteExpenseItem,
} from '@/lib/expenses/expense-service';
import { z } from 'zod';

const CATEGORY = z.enum([
  'infrastructure',
  'database',
  'ai',
  'email',
  'media',
  'monitoring',
  'security',
  'domain',
  'other',
]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CURRENCY = z.enum(['USD', 'PKR']);

const expenseItemFields = {
  subscriptionId: z.string().min(1),
  title: z.string().min(1).max(150),
  type: z.enum(['charge', 'deduction']),
  amount: z.number().positive(),
  currency: CURRENCY,
  dueDate: DATE,
  category: CATEGORY,
  notes: z.string().max(500).optional(),
};

const subscriptionFields = {
  name: z.string().min(1).max(100),
  provider: z.string().min(1).max(100),
  category: CATEGORY,
  billingCycle: z.enum(['monthly', 'quarterly', 'annual']),
  nextBillingDate: DATE,
  status: z.enum(['active', 'trial', 'canceling', 'paused']),
  currency: CURRENCY,
  autoRenew: z.boolean(),
  paymentMethod: z.string().min(1).max(100),
  planName: z.string().min(1).max(100),
  portalUrl: z.string().url().optional().or(z.literal('')),
  description: z.string().max(500).optional(),
};

const AddExpenseItemSchema = z.object({ ...expenseItemFields, currency: CURRENCY.default('USD') });

const AddSubscriptionSchema = z.object({
  ...subscriptionFields,
  status: subscriptionFields.status.default('active'),
  currency: CURRENCY.default('USD'),
  autoRenew: z.boolean().default(true),
});

// Changes name only the fields they change: no defaults (in zod 4 a default would fill in a field left
// out and overwrite it), and nothing else (an id or a timestamp is refused)
const UpdateExpenseItemSchema = z.object(expenseItemFields).partial().strict();
const UpdateSubscriptionSchema = z.object(subscriptionFields).partial().strict();

const DeleteSchema = z.object({
  entity: z.enum(['expense_item', 'subscription']),
  id: z.string().min(1).max(100),
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
 * Updates subscription details, an expense item, or the expense configuration settings.
 * Body shape:
 * - { entity: 'settings', data }
 * - { entity: 'subscription' | 'expense_item', id, data } (only the fields that change)
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

    if (body.entity === 'subscription' && typeof body.id === 'string' && body.id) {
      const parsed = UpdateSubscriptionSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: 'Invalid subscription payload', details: parsed.error.issues },
          { status: 400 }
        );
      }
      const updated = await updateSubscription(body.id, parsed.data, adminSession.email);
      if (!updated) {
        return NextResponse.json(
          { success: false, error: 'Subscription not found' },
          { status: 404 }
        );
      }
      return createSecureJsonResponse({ success: true, subscription: updated }, { status: 200 });
    }

    if (body.entity === 'expense_item' && typeof body.id === 'string' && body.id) {
      const parsed = UpdateExpenseItemSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: 'Invalid expense item payload', details: parsed.error.issues },
          { status: 400 }
        );
      }
      const item = await updateExpenseItem(body.id, parsed.data, adminSession.email);
      if (!item) {
        return NextResponse.json(
          { success: false, error: 'Expense item not found' },
          { status: 404 }
        );
      }
      return createSecureJsonResponse({ success: true, item }, { status: 200 });
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

/**
 * DELETE /api/admin/expenses
 * Removes an expense item, or a subscription with all its items.
 * Body shape: { entity: 'expense_item' | 'subscription', id }
 */
export async function DELETE(request: NextRequest) {
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

    const parsed = DeleteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid delete request', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { entity, id } = parsed.data;
    const removed = await (entity === 'subscription'
      ? deleteSubscription(id, adminSession.email)
      : deleteExpenseItem(id, adminSession.email));
    if (!removed) {
      return NextResponse.json(
        { success: false, error: entity === 'subscription' ? 'Subscription not found' : 'Expense item not found' },
        { status: 404 }
      );
    }
    return createSecureJsonResponse({ success: true }, { status: 200 });
  } catch (error) {
    console.error('[admin/expenses] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete expense entry' },
      { status: 500 }
    );
  }
}

