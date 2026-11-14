import crypto from 'node:crypto';
import { getAdminDb } from '@/lib/supabase/db';
import type {
  ExpenseManagerData,
  Subscription,
  ExpenseItem,
  GroupedSubscriptionExpenses,
  ExpenseSummary,
  ExpenseConfigSettings,
} from '@/types/expense';

const EXPENSE_SETTINGS_KEY = 'expense_manager_data';
const DEFAULT_EXCHANGE_RATE = 278.5; // USD to PKR current approximate bank rate

/**
 * Nothing until an admin adds it: the page shows only real subscriptions and charges, never example figures.
 */
export const DEFAULT_SUBSCRIPTIONS: Subscription[] = [];

export const DEFAULT_EXPENSES: ExpenseItem[] = [];

export const DEFAULT_CONFIG: ExpenseConfigSettings = {
  defaultCurrency: 'USD',
  alertThresholdUSD: 300,
  enableRenewalReminders: true,
  exchangeRateUsdToPkr: DEFAULT_EXCHANGE_RATE,
  lastUpdated: new Date().toISOString(),
  updatedBy: 'System',
};

// In-memory cache for fast sub-millisecond retrieval
let memoryCache: ExpenseManagerData | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

/**
 * Retrieves the full expense manager data from AppSettings or returns default fallback.
 */
export async function getExpenseManagerData(): Promise<ExpenseManagerData> {
  const now = Date.now();
  if (memoryCache && now - cacheTime < CACHE_TTL_MS) {
    return memoryCache;
  }

  try {
    const adminDb = getAdminDb();
    const { data, error } = await adminDb
      .from('AppSettings')
      .select('value')
      .eq('key', EXPENSE_SETTINGS_KEY)
      .maybeSingle();

    if (!error && data?.value) {
      const parsed = JSON.parse(data.value) as Partial<ExpenseManagerData>;
      if (parsed.subscriptions && parsed.expenses) {
        const result: ExpenseManagerData = {
          subscriptions: parsed.subscriptions,
          expenses: parsed.expenses,
          settings: { ...DEFAULT_CONFIG, ...(parsed.settings || {}) },
        };
        memoryCache = result;
        cacheTime = now;
        return result;
      }
    }
  } catch (err) {
    console.warn('[ExpenseService] Error reading from AppSettings, using seeded defaults:', err);
  }

  const defaultData: ExpenseManagerData = {
    subscriptions: DEFAULT_SUBSCRIPTIONS,
    expenses: DEFAULT_EXPENSES,
    settings: DEFAULT_CONFIG,
  };

  memoryCache = defaultData;
  cacheTime = now;
  return defaultData;
}

/**
 * Persists updated expense manager data to AppSettings.
 */
export async function saveExpenseManagerData(
  newData: ExpenseManagerData,
  updatedByAdmin?: string
): Promise<boolean> {
  try {
    const adminDb = getAdminDb();
    const payload = {
      ...newData,
      settings: {
        ...newData.settings,
        lastUpdated: new Date().toISOString(),
        updatedBy: updatedByAdmin || 'Admin',
      },
    };

    const { error } = await adminDb.from('AppSettings').upsert({
      key: EXPENSE_SETTINGS_KEY,
      value: JSON.stringify(payload),
      description: 'Expense Manager subscriptions, upcoming charges, deductions and settings.',
      updatedAt: new Date().toISOString(),
      updatedBy: updatedByAdmin || 'Admin',
    });

    if (error) {
      console.error('[ExpenseService] Error saving to AppSettings:', error);
      return false;
    }

    memoryCache = payload;
    cacheTime = Date.now();
    return true;
  } catch (err) {
    console.error('[ExpenseService] Failed to persist expense data:', err);
    return false;
  }
}

/**
 * Groups expenses by subscription and calculates individual totals.
 * Matches:
 * Subscription: Premium Plan
 * - Charge: $29.99 (next billing cycle)
 * - Deduction: $5.00 (discount)
 * Total: $24.99
 */
export function groupExpensesBySubscription(
  subscriptions: Subscription[],
  expenses: ExpenseItem[]
): GroupedSubscriptionExpenses[] {
  return subscriptions.map((sub) => {
    const subItems = expenses.filter((e) => e.subscriptionId === sub.id);

    const totalCharges = Number(
      subItems
        .filter((e) => e.type === 'charge')
        .reduce((sum, e) => sum + e.amount, 0)
        .toFixed(2)
    );

    const totalDeductions = Number(
      subItems
        .filter((e) => e.type === 'deduction')
        .reduce((sum, e) => sum + e.amount, 0)
        .toFixed(2)
    );

    const netTotal = Number((totalCharges - totalDeductions).toFixed(2));

    return {
      subscription: sub,
      items: subItems,
      totalCharges,
      totalDeductions,
      netTotal,
    };
  });
}

/**
 * Calculates high-level financial summary across all active subscriptions for the upcoming billing cycle.
 */
export function calculateExpenseSummary(
  groupedExpenses: GroupedSubscriptionExpenses[],
  exchangeRate: number = DEFAULT_EXCHANGE_RATE
): ExpenseSummary {
  let totalChargesUSD = 0;
  let totalDeductionsUSD = 0;
  let totalProjectedCostUSD = 0;

  const upcomingDates: string[] = [];

  for (const group of groupedExpenses) {
    if (group.subscription.status === 'active') {
      totalChargesUSD += group.totalCharges;
      totalDeductionsUSD += group.totalDeductions;
      totalProjectedCostUSD += group.netTotal;

      if (group.subscription.nextBillingDate) {
        upcomingDates.push(group.subscription.nextBillingDate);
      }
    }
  }

  totalChargesUSD = Number(totalChargesUSD.toFixed(2));
  totalDeductionsUSD = Number(totalDeductionsUSD.toFixed(2));
  totalProjectedCostUSD = Number(totalProjectedCostUSD.toFixed(2));

  const totalProjectedCostPKR = Math.round(totalProjectedCostUSD * exchangeRate);

  upcomingDates.sort();
  const nextUpcomingBillingDate = upcomingDates.length > 0 ? upcomingDates[0] : null;

  // Compute billing cycle label (e.g. "November 2026 Billing Cycle")
  const now = new Date();
  const monthName = now.toLocaleString('default', { month: 'long' });
  const year = now.getFullYear();
  const billingPeriodLabel = `${monthName} ${year} Billing Cycle`;

  return {
    totalProjectedCostUSD,
    totalProjectedCostPKR,
    totalChargesUSD,
    totalDeductionsUSD,
    totalActiveSubscriptions: groupedExpenses.filter((g) => g.subscription.status === 'active').length,
    nextUpcomingBillingDate,
    exchangeRateUsdToPkr: exchangeRate,
    billingPeriodLabel,
  };
}

/**
 * Saves a changed copy of the data, or throws. The changes below never touch the cached data (or the
 * seeded defaults it may be), so a save that fails leaves everything as it was and is reported as a failure.
 */
async function commit(next: ExpenseManagerData, adminEmail: string): Promise<void> {
  if (!(await saveExpenseManagerData(next, adminEmail))) {
    throw new Error('The expense data could not be saved');
  }
}

/**
 * Adds a new expense item to a subscription.
 */
export async function addExpenseItem(
  item: Omit<ExpenseItem, 'id'>,
  adminEmail: string
): Promise<ExpenseItem> {
  const data = await getExpenseManagerData();
  const newItem: ExpenseItem = {
    ...item,
    id: `exp-${Date.now()}-${crypto.randomUUID().split('-')[0]}`,
  };

  await commit({ ...data, expenses: [...data.expenses, newItem] }, adminEmail);
  return newItem;
}

/**
 * Adds a new subscription.
 */
export async function addSubscription(
  sub: Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>,
  adminEmail: string
): Promise<Subscription> {
  const data = await getExpenseManagerData();
  const now = new Date().toISOString();
  const newSub: Subscription = {
    ...sub,
    id: `sub-${Date.now()}-${crypto.randomUUID().split('-')[0]}`,
    createdAt: now,
    updatedAt: now,
  };

  await commit({ ...data, subscriptions: [...data.subscriptions, newSub] }, adminEmail);
  return newSub;
}

/**
 * Updates an existing subscription.
 */
export async function updateSubscription(
  id: string,
  updates: Partial<Subscription>,
  adminEmail: string
): Promise<Subscription | null> {
  const data = await getExpenseManagerData();
  const idx = data.subscriptions.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  const current = data.subscriptions[idx];
  // Its id and creation time stay whatever the update says
  const updatedSub = {
    ...current,
    ...updates,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  await commit({ ...data, subscriptions: data.subscriptions.map((s, i) => (i === idx ? updatedSub : s)) }, adminEmail);
  return updatedSub;
}

/**
 * Removes a subscription and its expense items. False when there is none with that id.
 */
export async function deleteSubscription(id: string, adminEmail: string): Promise<boolean> {
  const data = await getExpenseManagerData();
  if (!data.subscriptions.some((s) => s.id === id)) return false;

  await commit(
    {
      ...data,
      subscriptions: data.subscriptions.filter((s) => s.id !== id),
      expenses: data.expenses.filter((e) => e.subscriptionId !== id),
    },
    adminEmail
  );
  return true;
}

/**
 * Updates an expense item. Null when there is none with that id.
 */
export async function updateExpenseItem(
  id: string,
  updates: Partial<Omit<ExpenseItem, 'id'>>,
  adminEmail: string
): Promise<ExpenseItem | null> {
  const data = await getExpenseManagerData();
  const current = data.expenses.find((e) => e.id === id);
  if (!current) return null;

  const updatedItem: ExpenseItem = { ...current, ...updates, id: current.id };
  await commit({ ...data, expenses: data.expenses.map((e) => (e.id === id ? updatedItem : e)) }, adminEmail);
  return updatedItem;
}

/**
 * Removes an expense item. False when there is none with that id.
 */
export async function deleteExpenseItem(id: string, adminEmail: string): Promise<boolean> {
  const data = await getExpenseManagerData();
  if (!data.expenses.some((e) => e.id === id)) return false;

  await commit({ ...data, expenses: data.expenses.filter((e) => e.id !== id) }, adminEmail);
  return true;
}

/**
 * Updates expense manager configuration settings.
 */
export async function updateExpenseSettings(
  settings: Partial<ExpenseConfigSettings>,
  adminEmail: string
): Promise<ExpenseConfigSettings> {
  const data = await getExpenseManagerData();
  const updated: ExpenseConfigSettings = {
    ...data.settings,
    ...settings,
    lastUpdated: new Date().toISOString(),
    updatedBy: adminEmail,
  };

  await commit({ ...data, settings: updated }, adminEmail);
  return updated;
}

