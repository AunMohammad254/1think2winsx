'use server';

import { requireAdminSession } from '@/lib/admin-session';
import {
  getExpenseManagerData,
  groupExpensesBySubscription,
  calculateExpenseSummary,
  addExpenseItem,
  addSubscription,
  updateSubscription,
  updateExpenseSettings,
} from '@/lib/expenses/expense-service';
import type {
  ExpenseManagerData,
  GroupedSubscriptionExpenses,
  ExpenseSummary,
  ExpenseItem,
  Subscription,
  ExpenseConfigSettings,
} from '@/types/expense';

export interface ExpenseDashboardResponse {
  summary: ExpenseSummary;
  groupedExpenses: GroupedSubscriptionExpenses[];
  subscriptions: Subscription[];
  expenses: ExpenseItem[];
  settings: ExpenseConfigSettings;
}

/**
 * Fetches all expense manager data, ensuring the caller is an authenticated admin.
 */
export async function getExpenseDashboardData(): Promise<ExpenseDashboardResponse> {
  await requireAdminSession();

  const data: ExpenseManagerData = await getExpenseManagerData();
  const groupedExpenses = groupExpensesBySubscription(data.subscriptions, data.expenses);
  const summary = calculateExpenseSummary(groupedExpenses, data.settings.exchangeRateUsdToPkr);

  return {
    summary,
    groupedExpenses,
    subscriptions: data.subscriptions,
    expenses: data.expenses,
    settings: data.settings,
  };
}

/**
 * Action to record a new expense item (charge or deduction).
 */
export async function recordExpenseItem(
  item: Omit<ExpenseItem, 'id'>
): Promise<{ success: boolean; item?: ExpenseItem; error?: string }> {
  try {
    const adminEmail = await requireAdminSession();
    const created = await addExpenseItem(item, adminEmail);
    return { success: true, item: created };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Action to record a new subscription.
 */
export async function recordSubscription(
  sub: Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ success: boolean; subscription?: Subscription; error?: string }> {
  try {
    const adminEmail = await requireAdminSession();
    const created = await addSubscription(sub, adminEmail);
    return { success: true, subscription: created };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Action to update a subscription status or parameters.
 */
export async function modifySubscription(
  id: string,
  updates: Partial<Subscription>
): Promise<{ success: boolean; subscription?: Subscription; error?: string }> {
  try {
    const adminEmail = await requireAdminSession();
    const updated = await updateSubscription(id, updates, adminEmail);
    if (!updated) return { success: false, error: 'Subscription not found' };
    return { success: true, subscription: updated };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Action to update configuration settings.
 */
export async function saveExpenseSettings(
  settings: Partial<ExpenseConfigSettings>
): Promise<{ success: boolean; settings?: ExpenseConfigSettings; error?: string }> {
  try {
    const adminEmail = await requireAdminSession();
    const updated = await updateExpenseSettings(settings, adminEmail);
    return { success: true, settings: updated };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

