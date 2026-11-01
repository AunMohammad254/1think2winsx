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
 * Default seeded project subscriptions reflecting the actual infrastructure of 1Think 2Win.
 */
export const DEFAULT_SUBSCRIPTIONS: Subscription[] = [
  {
    id: 'sub-supabase',
    name: 'Supabase Database & Auth',
    provider: 'Supabase Inc.',
    category: 'database',
    billingCycle: 'monthly',
    nextBillingDate: '2026-11-15',
    status: 'active',
    currency: 'USD',
    autoRenew: true,
    paymentMethod: 'Mastercard ending in 4112',
    planName: 'Pro Tier + Compute Add-on',
    portalUrl: 'https://supabase.com/dashboard/org/billing',
    description: 'PostgreSQL instance, Auth engine, and Edge functions.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'sub-hostinger',
    name: 'Hostinger Cloud & VPS Hosting',
    provider: 'Hostinger International',
    category: 'infrastructure',
    billingCycle: 'monthly',
    nextBillingDate: '2026-11-18',
    status: 'active',
    currency: 'USD',
    autoRenew: true,
    paymentMethod: 'Corporate Visa ending in 9821',
    planName: 'KVM 2 Cloud VPS',
    portalUrl: 'https://hpanel.hostinger.com/billing',
    description: 'Next.js application runtime, PM2 process management, and reverse proxy.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'sub-aws-ses',
    name: 'Amazon Web Services (SES & Cloud)',
    provider: 'Amazon Web Services',
    category: 'email',
    billingCycle: 'monthly',
    nextBillingDate: '2026-11-30',
    status: 'active',
    currency: 'USD',
    autoRenew: true,
    paymentMethod: 'AWS Consolidated Billing',
    planName: 'Production SES (ap-southeast-2 Sydney)',
    portalUrl: 'https://console.aws.amazon.com/costmanagement/home',
    description: 'Transactional notifications, daily user digests, and SNS bounce tracking.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'sub-brevo',
    name: 'Brevo (Sendinblue) Email Backup',
    provider: 'Brevo SAS',
    category: 'email',
    billingCycle: 'monthly',
    nextBillingDate: '2026-11-22',
    status: 'active',
    currency: 'USD',
    autoRenew: true,
    paymentMethod: 'Corporate Visa ending in 9821',
    planName: 'Starter Plan (40k emails/month)',
    portalUrl: 'https://app.brevo.com/billing',
    description: 'High-availability email failover and marketing announcements.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'sub-cloudinary',
    name: 'Cloudinary Media Storage',
    provider: 'Cloudinary Ltd.',
    category: 'media',
    billingCycle: 'monthly',
    nextBillingDate: '2026-11-10',
    status: 'active',
    currency: 'USD',
    autoRenew: true,
    paymentMethod: 'Mastercard ending in 4112',
    planName: 'Plus Plan (Transformations & CDN)',
    portalUrl: 'https://cloudinary.com/console/billing',
    description: 'Quiz prize imagery, winner proof media, and avatar asset optimization.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'sub-sentry',
    name: 'Sentry Application Monitoring',
    provider: 'Functional Software, Inc.',
    category: 'monitoring',
    billingCycle: 'monthly',
    nextBillingDate: '2026-11-14',
    status: 'active',
    currency: 'USD',
    autoRenew: true,
    paymentMethod: 'Corporate Visa ending in 9821',
    planName: 'Team Tier',
    portalUrl: 'https://sentry.io/settings/billing',
    description: 'Real-time frontend and edge server exception tracking and performance tracing.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'sub-google-gemini',
    name: 'Google Cloud Gemini AI Studio',
    provider: 'Google Cloud Platform',
    category: 'ai',
    billingCycle: 'monthly',
    nextBillingDate: '2026-11-28',
    status: 'active',
    currency: 'USD',
    autoRenew: true,
    paymentMethod: 'Google Payments Account',
    planName: 'Pay-as-you-go API (Gemini 2.5/3.1)',
    portalUrl: 'https://console.cloud.google.com/billing',
    description: 'Match mode live question wording, translation, and user chatbot queries.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'sub-cloudflare',
    name: 'Cloudflare Edge Shield & Domain',
    provider: 'Cloudflare, Inc.',
    category: 'security',
    billingCycle: 'monthly',
    nextBillingDate: '2026-11-25',
    status: 'active',
    currency: 'USD',
    autoRenew: true,
    paymentMethod: 'Corporate Visa ending in 9821',
    planName: 'Pro Domain + Turnstile Enterprise Tier',
    portalUrl: 'https://dash.cloudflare.com/billing',
    description: 'DDoS mitigation, Turnstile CAPTCHA bot protection, and edge SSL caching.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
];

/**
 * Default seeded expenses for the upcoming billing cycle showing both charges and deductions/discounts.
 */
export const DEFAULT_EXPENSES: ExpenseItem[] = [
  // Supabase
  {
    id: 'exp-sup-1',
    subscriptionId: 'sub-supabase',
    title: 'Base Pro Plan Subscription',
    type: 'charge',
    amount: 25.0,
    currency: 'USD',
    dueDate: '2026-11-15',
    category: 'database',
    notes: 'Monthly fixed platform fee including 8GB database and Auth',
  },
  {
    id: 'exp-sup-2',
    subscriptionId: 'sub-supabase',
    title: 'Compute Add-on (Small Instance)',
    type: 'charge',
    amount: 10.0,
    currency: 'USD',
    dueDate: '2026-11-15',
    category: 'database',
    notes: 'High-availability compute add-on for quiz concurrency',
  },
  {
    id: 'exp-sup-3',
    subscriptionId: 'sub-supabase',
    title: 'Promotional Compute Credit',
    type: 'deduction',
    amount: 10.0,
    currency: 'USD',
    dueDate: '2026-11-15',
    category: 'database',
    notes: 'Platform loyalty compute voucher applied automatically',
  },

  // Hostinger
  {
    id: 'exp-hos-1',
    subscriptionId: 'sub-hostinger',
    title: 'VPS KVM 2 Monthly Renewal',
    type: 'charge',
    amount: 19.99,
    currency: 'USD',
    dueDate: '2026-11-18',
    category: 'infrastructure',
    notes: 'Linux virtual machine dedicated hosting',
  },
  {
    id: 'exp-hos-2',
    subscriptionId: 'sub-hostinger',
    title: 'Long-term Commitment Discount',
    type: 'deduction',
    amount: 5.0,
    currency: 'USD',
    dueDate: '2026-11-18',
    category: 'infrastructure',
    notes: 'Special partner renewal deduction',
  },

  // AWS SES
  {
    id: 'exp-aws-1',
    subscriptionId: 'sub-aws-ses',
    title: 'Projected SES Email Deliveries',
    type: 'charge',
    amount: 15.0,
    currency: 'USD',
    dueDate: '2026-11-30',
    category: 'email',
    notes: 'Forecasted volume from AWS Cost Explorer cache ($0.10 / 1000 emails)',
  },
  {
    id: 'exp-aws-2',
    subscriptionId: 'sub-aws-ses',
    title: 'AWS Free Usage Tier Credit',
    type: 'deduction',
    amount: 2.5,
    currency: 'USD',
    dueDate: '2026-11-30',
    category: 'email',
    notes: 'Deduction for first 62,000 outgoing messages',
  },

  // Brevo
  {
    id: 'exp-brevo-1',
    subscriptionId: 'sub-brevo',
    title: 'Starter Monthly Email Subscription',
    type: 'charge',
    amount: 15.0,
    currency: 'USD',
    dueDate: '2026-11-22',
    category: 'email',
    notes: 'Secondary backup SMTP pipeline',
  },
  {
    id: 'exp-brevo-2',
    subscriptionId: 'sub-brevo',
    title: 'Annual Loyalty Deduction',
    type: 'deduction',
    amount: 3.0,
    currency: 'USD',
    dueDate: '2026-11-22',
    category: 'email',
    notes: 'Account retention promotion',
  },

  // Cloudinary
  {
    id: 'exp-cld-1',
    subscriptionId: 'sub-cloudinary',
    title: 'Plus Plan Monthly License',
    type: 'charge',
    amount: 89.0,
    currency: 'USD',
    dueDate: '2026-11-10',
    category: 'media',
    notes: 'Storage for user prize redemption photos and videos',
  },
  {
    id: 'exp-cld-2',
    subscriptionId: 'sub-cloudinary',
    title: 'Bandwidth Optimizer Rebate',
    type: 'deduction',
    amount: 15.0,
    currency: 'USD',
    dueDate: '2026-11-10',
    category: 'media',
    notes: 'Automatic caching discount',
  },

  // Sentry
  {
    id: 'exp-sen-1',
    subscriptionId: 'sub-sentry',
    title: 'Team Plan Subscription',
    type: 'charge',
    amount: 26.0,
    currency: 'USD',
    dueDate: '2026-11-14',
    category: 'monitoring',
    notes: 'Includes 50k error events and 100k transactions',
  },
  {
    id: 'exp-sen-2',
    subscriptionId: 'sub-sentry',
    title: 'Startup Program Discount',
    type: 'deduction',
    amount: 6.0,
    currency: 'USD',
    dueDate: '2026-11-14',
    category: 'monitoring',
    notes: 'Eligible software program discount applied',
  },

  // Google Cloud Gemini
  {
    id: 'exp-gem-1',
    subscriptionId: 'sub-google-gemini',
    title: 'Estimated AI API Usage Fee',
    type: 'charge',
    amount: 35.0,
    currency: 'USD',
    dueDate: '2026-11-28',
    category: 'ai',
    notes: 'Live match Urdu translation and quiz question generation',
  },
  {
    id: 'exp-gem-2',
    subscriptionId: 'sub-google-gemini',
    title: 'Google Cloud Monthly Free Tier',
    type: 'deduction',
    amount: 10.0,
    currency: 'USD',
    dueDate: '2026-11-28',
    category: 'ai',
    notes: 'Complimentary monthly developer credit',
  },

  // Cloudflare
  {
    id: 'exp-cf-1',
    subscriptionId: 'sub-cloudflare',
    title: 'Pro Plan Zone Subscription',
    type: 'charge',
    amount: 20.0,
    currency: 'USD',
    dueDate: '2026-11-25',
    category: 'security',
    notes: 'WAF, rate limiting, and Turnstile enterprise protection',
  },
  {
    id: 'exp-cf-2',
    subscriptionId: 'sub-cloudflare',
    title: 'Multi-Product Bundle Deduction',
    type: 'deduction',
    amount: 5.0,
    currency: 'USD',
    dueDate: '2026-11-25',
    category: 'security',
    notes: 'Discount for DNS + Turnstile + Edge Shield package',
  },
];

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
 * Adds a new expense item to a subscription.
 */
export async function addExpenseItem(
  item: Omit<ExpenseItem, 'id'>,
  adminEmail: string
): Promise<ExpenseItem> {
  const data = await getExpenseManagerData();
  const newItem: ExpenseItem = {
    ...item,
    id: `exp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
  };

  data.expenses.push(newItem);
  await saveExpenseManagerData(data, adminEmail);
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
    id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    createdAt: now,
    updatedAt: now,
  };

  data.subscriptions.push(newSub);
  await saveExpenseManagerData(data, adminEmail);
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

  const updatedSub = {
    ...data.subscriptions[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  data.subscriptions[idx] = updatedSub;
  await saveExpenseManagerData(data, adminEmail);
  return updatedSub;
}

/**
 * Updates expense manager configuration settings.
 */
export async function updateExpenseSettings(
  settings: Partial<ExpenseConfigSettings>,
  adminEmail: string
): Promise<ExpenseConfigSettings> {
  const data = await getExpenseManagerData();
  data.settings = {
    ...data.settings,
    ...settings,
    lastUpdated: new Date().toISOString(),
    updatedBy: adminEmail,
  };

  await saveExpenseManagerData(data, adminEmail);
  return data.settings;
}

