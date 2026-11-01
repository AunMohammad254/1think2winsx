/**
 * Expense Manager Types
 * Defines data structures for subscriptions, upcoming charges, deductions, and financial summaries.
 */

export type ExpenseCategory =
  | 'infrastructure'
  | 'database'
  | 'ai'
  | 'email'
  | 'media'
  | 'monitoring'
  | 'security'
  | 'domain'
  | 'other';

export type BillingCycle = 'monthly' | 'quarterly' | 'annual';

export type SubscriptionStatus = 'active' | 'trial' | 'canceling' | 'paused';

export type ExpenseItemType = 'charge' | 'deduction';

export interface ExpenseItem {
  id: string;
  subscriptionId: string;
  title: string;
  type: ExpenseItemType;
  amount: number;
  currency: 'USD' | 'PKR';
  dueDate: string; // ISO date YYYY-MM-DD
  category: ExpenseCategory;
  notes?: string;
  isRecurring?: boolean;
}

export interface Subscription {
  id: string;
  name: string;
  provider: string;
  category: ExpenseCategory;
  billingCycle: BillingCycle;
  nextBillingDate: string; // ISO date YYYY-MM-DD
  status: SubscriptionStatus;
  currency: 'USD' | 'PKR';
  autoRenew: boolean;
  paymentMethod: string;
  planName: string;
  portalUrl?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupedSubscriptionExpenses {
  subscription: Subscription;
  items: ExpenseItem[];
  totalCharges: number;
  totalDeductions: number;
  netTotal: number;
}

export interface ExpenseSummary {
  totalProjectedCostUSD: number;
  totalProjectedCostPKR: number;
  totalChargesUSD: number;
  totalDeductionsUSD: number;
  totalActiveSubscriptions: number;
  nextUpcomingBillingDate: string | null;
  exchangeRateUsdToPkr: number;
  billingPeriodLabel: string;
}

export interface ExpenseConfigSettings {
  defaultCurrency: 'USD' | 'PKR';
  alertThresholdUSD: number;
  enableRenewalReminders: boolean;
  exchangeRateUsdToPkr: number;
  lastUpdated?: string;
  updatedBy?: string | null;
}

export interface ExpenseManagerData {
  subscriptions: Subscription[];
  expenses: ExpenseItem[];
  settings: ExpenseConfigSettings;
}

