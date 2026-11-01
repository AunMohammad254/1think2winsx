import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { resolveServerTree } from '@/tests/helpers/server-render';

const h = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  validateAdminSession: vi.fn(),
}));

vi.mock('@/lib/admin-session', () => ({
  requireAdminSession: () => h.requireAdminSession(),
  validateAdminSession: () => h.validateAdminSession(),
}));

vi.mock('@/lib/csrf', () => ({
  getCSRFHeaders: async () => ({ 'X-CSRF-Token': 'test-csrf-token' }),
}));

import AdminExpensesPage from '@/app/admin/(protected)/expenses/page';
import ExpenseManager from '@/components/admin/expenses/ExpenseManager';
import { GET as getExpensesApi } from '@/app/api/admin/expenses/route';
import type {
  ExpenseSummary,
  GroupedSubscriptionExpenses,
  Subscription,
  ExpenseItem,
  ExpenseConfigSettings,
} from '@/types/expense';

describe('Admin Expense Manager Page and Components', () => {
  const sampleSubscription: Subscription = {
    id: 'sub-test-1',
    name: 'Premium Cloud Plan',
    provider: 'Cloud Host Inc.',
    category: 'infrastructure',
    billingCycle: 'monthly',
    nextBillingDate: '2026-11-20',
    status: 'active',
    currency: 'USD',
    autoRenew: true,
    paymentMethod: 'Corporate Visa ending in 4242',
    planName: 'Enterprise 4-Core',
    portalUrl: 'https://cloudhost.com/billing',
    description: 'High availability VPS for application processing',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };

  const sampleItems: ExpenseItem[] = [
    {
      id: 'item-1',
      subscriptionId: 'sub-test-1',
      title: 'Monthly Subscription',
      type: 'charge',
      amount: 29.99,
      currency: 'USD',
      dueDate: '2026-11-20',
      category: 'infrastructure',
      notes: 'Base compute charge for upcoming cycle',
    },
    {
      id: 'item-2',
      subscriptionId: 'sub-test-1',
      title: 'Partner Loyalty Discount',
      type: 'deduction',
      amount: 5.0,
      currency: 'USD',
      dueDate: '2026-11-20',
      category: 'infrastructure',
      notes: 'Monthly promotional deduction applied',
    },
  ];

  const sampleGroup: GroupedSubscriptionExpenses = {
    subscription: sampleSubscription,
    items: sampleItems,
    totalCharges: 29.99,
    totalDeductions: 5.0,
    netTotal: 24.99,
  };

  const sampleSummary: ExpenseSummary = {
    totalProjectedCostUSD: 24.99,
    totalProjectedCostPKR: 6960,
    totalChargesUSD: 29.99,
    totalDeductionsUSD: 5.0,
    totalActiveSubscriptions: 1,
    nextUpcomingBillingDate: '2026-11-20',
    exchangeRateUsdToPkr: 278.5,
    billingPeriodLabel: 'November 2026 Billing Cycle',
  };

  const sampleSettings: ExpenseConfigSettings = {
    defaultCurrency: 'USD',
    alertThresholdUSD: 50.0,
    enableRenewalReminders: true,
    exchangeRateUsdToPkr: 278.5,
  };

  beforeEach(() => {
    h.requireAdminSession.mockReset().mockResolvedValue('admin@1think2win.com');
    h.validateAdminSession.mockReset().mockResolvedValue({
      valid: true,
      email: 'admin@1think2win.com',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the Expense Manager page after verifying admin session', async () => {
    const pageTree = await resolveServerTree(await AdminExpensesPage());
    render(pageTree);

    expect(h.requireAdminSession).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Expense Manager' })).toBeInTheDocument();
    expect(
      screen.getByText(/All subscriptions, expected deductions, and scheduled charges/i)
    ).toBeInTheDocument();
  });

  it('displays subscription expense cards with expected charges, deductions, and net totals', () => {
    render(
      <ExpenseManager
        initialSummary={sampleSummary}
        initialGroupedExpenses={[sampleGroup]}
        initialSubscriptions={[sampleSubscription]}
        initialExpenses={sampleItems}
        initialSettings={sampleSettings}
      />
    );

    // Matches the required example layout:
    // Subscription: Premium Plan
    // - Charge: $29.99 (next billing cycle)
    // - Deduction: $5.00 (discount)
    // Total: $24.99
    expect(screen.getByText('Subscription: Premium Cloud Plan')).toBeInTheDocument();
    expect(screen.getByText('Monthly Subscription')).toBeInTheDocument();
    expect(screen.getAllByText('$29.99').length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText('Partner Loyalty Discount')).toBeInTheDocument();
    expect(screen.getAllByText('-$5.00').length).toBeGreaterThanOrEqual(1);

    // Group net total
    expect(screen.getAllByText('$24.99').length).toBeGreaterThanOrEqual(1);

    // Provider and plan badge
    expect(screen.getByText('Enterprise 4-Core')).toBeInTheDocument();
    expect(screen.getByText('Cloud Host Inc.')).toBeInTheDocument();
  });

  it('switches currency display between USD ($) and PKR (₨)', () => {
    render(
      <ExpenseManager
        initialSummary={sampleSummary}
        initialGroupedExpenses={[sampleGroup]}
        initialSubscriptions={[sampleSubscription]}
        initialExpenses={sampleItems}
        initialSettings={sampleSettings}
      />
    );

    expect(screen.getAllByText('$24.99').length).toBeGreaterThanOrEqual(1);

    // Switch to PKR
    const pkrButton = screen.getByRole('button', { name: /PKR/i });
    fireEvent.click(pkrButton);

    // 24.99 * 278.50 ≈ 6,960
    expect(screen.getAllByText('₨ 6,960').length).toBeGreaterThanOrEqual(1);
  });

  it('filters subscriptions by search query', () => {
    const sub2: Subscription = {
      ...sampleSubscription,
      id: 'sub-test-2',
      name: 'Supabase Database',
      provider: 'Supabase Inc.',
    };

    const group2: GroupedSubscriptionExpenses = {
      subscription: sub2,
      items: [],
      totalCharges: 25.0,
      totalDeductions: 0,
      netTotal: 25.0,
    };

    render(
      <ExpenseManager
        initialSummary={sampleSummary}
        initialGroupedExpenses={[sampleGroup, group2]}
        initialSubscriptions={[sampleSubscription, sub2]}
        initialExpenses={sampleItems}
        initialSettings={sampleSettings}
      />
    );

    expect(screen.getByText('Subscription: Premium Cloud Plan')).toBeInTheDocument();
    expect(screen.getByText('Subscription: Supabase Database')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search subscription or line item/i);
    fireEvent.change(searchInput, { target: { value: 'Supabase' } });

    expect(screen.queryByText('Subscription: Premium Cloud Plan')).not.toBeInTheDocument();
    expect(screen.getByText('Subscription: Supabase Database')).toBeInTheDocument();
  });

  it('displays budget alert banner when projected cost exceeds threshold', () => {
    const tightBudgetSettings: ExpenseConfigSettings = {
      ...sampleSettings,
      alertThresholdUSD: 20.0, // lower than projected 24.99
    };

    render(
      <ExpenseManager
        initialSummary={sampleSummary}
        initialGroupedExpenses={[sampleGroup]}
        initialSubscriptions={[sampleSubscription]}
        initialExpenses={sampleItems}
        initialSettings={tightBudgetSettings}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText(/Upcoming Cycle Budget Alert Exceeded/i)
    ).toBeInTheDocument();
  });

  it('rejects unauthorized access to the GET /api/admin/expenses endpoint', async () => {
    h.validateAdminSession.mockResolvedValueOnce({ valid: false });

    const response = await getExpensesApi();
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Unauthorized/i);
  });

  it('returns expense data with 200 OK for authorized admin on GET /api/admin/expenses', async () => {
    const response = await getExpensesApi();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.summary).toBeDefined();
    expect(body.groupedExpenses).toBeInstanceOf(Array);
    expect(body.subscriptions).toBeInstanceOf(Array);
  });
});
