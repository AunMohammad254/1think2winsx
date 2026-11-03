import { describe, it, expect } from 'vitest';
import {
  groupExpensesBySubscription,
  calculateExpenseSummary,
  DEFAULT_SUBSCRIPTIONS,
  DEFAULT_EXPENSES,
} from '@/lib/expenses/expense-service';
import type { Subscription, ExpenseItem } from '@/types/expense';

describe('expense-service calculations and grouping', () => {
  const sampleSubscription: Subscription = {
    id: 'sub-test-1',
    name: 'Premium Plan',
    provider: 'Acme Cloud',
    category: 'infrastructure',
    billingCycle: 'monthly',
    nextBillingDate: '2026-11-20',
    status: 'active',
    currency: 'USD',
    autoRenew: true,
    paymentMethod: 'Corporate Visa ending in 1234',
    planName: 'Enterprise Cluster',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };

  it('correctly calculates total charges, deductions, and net total per subscription (user example)', () => {
    // Example from requirement:
    // Subscription: Premium Plan
    // - Charge: $29.99 (next billing cycle)
    // - Deduction: $5.00 (discount)
    // Total: $24.99
    const items: ExpenseItem[] = [
      {
        id: 'item-1',
        subscriptionId: 'sub-test-1',
        title: 'Monthly Subscription',
        type: 'charge',
        amount: 29.99,
        currency: 'USD',
        dueDate: '2026-11-20',
        category: 'infrastructure',
      },
      {
        id: 'item-2',
        subscriptionId: 'sub-test-1',
        title: 'Discount Voucher',
        type: 'deduction',
        amount: 5.0,
        currency: 'USD',
        dueDate: '2026-11-20',
        category: 'infrastructure',
      },
    ];

    const grouped = groupExpensesBySubscription([sampleSubscription], items);
    expect(grouped).toHaveLength(1);

    const group = grouped[0];
    expect(group.subscription.name).toBe('Premium Plan');
    expect(group.totalCharges).toBe(29.99);
    expect(group.totalDeductions).toBe(5.0);
    expect(group.netTotal).toBe(24.99);
  });

  it('handles multiple charges and deductions accurately with floating point precision', () => {
    const items: ExpenseItem[] = [
      {
        id: 'i1',
        subscriptionId: 'sub-test-1',
        title: 'Base License',
        type: 'charge',
        amount: 19.99,
        currency: 'USD',
        dueDate: '2026-11-20',
        category: 'infrastructure',
      },
      {
        id: 'i2',
        subscriptionId: 'sub-test-1',
        title: 'Bandwidth Add-on',
        type: 'charge',
        amount: 10.0,
        currency: 'USD',
        dueDate: '2026-11-20',
        category: 'infrastructure',
      },
      {
        id: 'i3',
        subscriptionId: 'sub-test-1',
        title: 'Annual Loyalty Credit',
        type: 'deduction',
        amount: 4.5,
        currency: 'USD',
        dueDate: '2026-11-20',
        category: 'infrastructure',
      },
      {
        id: 'i4',
        subscriptionId: 'sub-test-1',
        title: 'Promotional Rebate',
        type: 'deduction',
        amount: 2.5,
        currency: 'USD',
        dueDate: '2026-11-20',
        category: 'infrastructure',
      },
    ];

    const grouped = groupExpensesBySubscription([sampleSubscription], items);
    const group = grouped[0];

    // Charges: 19.99 + 10.00 = 29.99
    // Deductions: 4.50 + 2.50 = 7.00
    // Net: 22.99
    expect(group.totalCharges).toBe(29.99);
    expect(group.totalDeductions).toBe(7.0);
    expect(group.netTotal).toBe(22.99);
  });

  it('calculates aggregate summary with exchange rate to PKR and earliest upcoming date', () => {
    const sub2: Subscription = {
      ...sampleSubscription,
      id: 'sub-test-2',
      name: 'Database Cluster',
      nextBillingDate: '2026-11-10',
    };

    const items: ExpenseItem[] = [
      {
        id: 'i1',
        subscriptionId: 'sub-test-1',
        title: 'Server',
        type: 'charge',
        amount: 100,
        currency: 'USD',
        dueDate: '2026-11-20',
        category: 'infrastructure',
      },
      {
        id: 'i2',
        subscriptionId: 'sub-test-1',
        title: 'Credit',
        type: 'deduction',
        amount: 20,
        currency: 'USD',
        dueDate: '2026-11-20',
        category: 'infrastructure',
      },
      {
        id: 'i3',
        subscriptionId: 'sub-test-2',
        title: 'Database Engine',
        type: 'charge',
        amount: 50,
        currency: 'USD',
        dueDate: '2026-11-10',
        category: 'database',
      },
    ];

    const grouped = groupExpensesBySubscription([sampleSubscription, sub2], items);
    const summary = calculateExpenseSummary(grouped, 280);

    // sub 1: 100 - 20 = 80
    // sub 2: 50 - 0 = 50
    // Total charges = 150
    // Total deductions = 20
    // Net USD = 130
    // Net PKR = 130 * 280 = 36,400
    expect(summary.totalChargesUSD).toBe(150);
    expect(summary.totalDeductionsUSD).toBe(20);
    expect(summary.totalProjectedCostUSD).toBe(130);
    expect(summary.totalProjectedCostPKR).toBe(36400);
    expect(summary.totalActiveSubscriptions).toBe(2);
    expect(summary.nextUpcomingBillingDate).toBe('2026-11-10');
  });

  it('ignores paused or inactive subscriptions in upcoming totals', () => {
    const pausedSub: Subscription = {
      ...sampleSubscription,
      id: 'sub-paused',
      status: 'paused',
    };

    const items: ExpenseItem[] = [
      {
        id: 'i-paused',
        subscriptionId: 'sub-paused',
        title: 'Inactive Service',
        type: 'charge',
        amount: 500,
        currency: 'USD',
        dueDate: '2026-11-20',
        category: 'infrastructure',
      },
    ];

    const grouped = groupExpensesBySubscription([pausedSub], items);
    const summary = calculateExpenseSummary(grouped, 278.5);

    expect(summary.totalProjectedCostUSD).toBe(0);
    expect(summary.totalActiveSubscriptions).toBe(0);
  });

  it('starts with no subscriptions or charges: no example figures before an admin adds real ones', () => {
    expect(DEFAULT_SUBSCRIPTIONS).toEqual([]);
    expect(DEFAULT_EXPENSES).toEqual([]);
  });
});

