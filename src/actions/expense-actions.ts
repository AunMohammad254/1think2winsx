'use server';

import { requireAdminSession } from '@/lib/admin-session';
import {
  getExpenseManagerData,
  groupExpensesBySubscription,
  calculateExpenseSummary,
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
