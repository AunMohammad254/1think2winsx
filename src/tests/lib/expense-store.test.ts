// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';
import type { ExpenseManagerData, Subscription } from '@/types/expense';

let adminDb: SupabaseMock;
let dbBroken = false;
vi.mock('@/lib/supabase/db', () => ({
  getAdminDb: () => {
    if (dbBroken) throw new Error('Supabase is not configured');
    return adminDb.client;
  },
}));

// The service keeps its data for a minute in the module: every test starts from a fresh copy
const fresh = async () => {
  vi.resetModules();
  return import('@/lib/expenses/expense-service');
};

const SUB: Subscription = {
  id: 'sub-1', name: 'Supabase Pro', provider: 'Supabase Inc.', category: 'database', billingCycle: 'monthly',
  nextBillingDate: '2026-11-20', status: 'active', currency: 'USD', autoRenew: true, paymentMethod: 'Visa',
  planName: 'Pro', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const SAVED: ExpenseManagerData = {
  subscriptions: [SUB],
  expenses: [{ id: 'e1', subscriptionId: 'sub-1', title: 'Pro plan', type: 'charge', amount: 25, currency: 'USD', dueDate: '2026-11-20', category: 'database' }],
  settings: { defaultCurrency: 'PKR', alertThresholdUSD: 100, enableRenewalReminders: false, exchangeRateUsdToPkr: 280 },
};
const row = (value: unknown) => ({ data: { value: JSON.stringify(value) }, error: null });
const upserted = () => argOf(adminDb.callsTo('AppSettings', 'upsert').at(-1), 'upsert') as { key: string; value: string; updatedBy: string };

beforeEach(() => {
  dbBroken = false;
  adminDb = createSupabaseMock({ tables: { AppSettings: { data: null, error: null } } });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('expense-service: reading the saved data', () => {
  it('reads the saved data from AppSettings, and keeps it a minute', async () => {
    adminDb = createSupabaseMock({ tables: { AppSettings: row(SAVED) } });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const service = await fresh();
    const data = await service.getExpenseManagerData();
    expect(data.subscriptions).toEqual([SUB]);
    expect(data.settings).toMatchObject({ defaultCurrency: 'PKR', exchangeRateUsdToPkr: 280, updatedBy: 'System' });
    expect(eqValue(adminDb.callsTo('AppSettings')[0], 'key')).toBe('expense_manager_data');

    now.mockReturnValue(1_000_000 + 59_000);
    await service.getExpenseManagerData();
    expect(adminDb.callsTo('AppSettings')).toHaveLength(1);
    now.mockReturnValue(1_000_000 + 61_000);
    await service.getExpenseManagerData();
    expect(adminDb.callsTo('AppSettings')).toHaveLength(2);
  });

  it('fills in default settings when the saved data has none', async () => {
    adminDb = createSupabaseMock({ tables: { AppSettings: row({ subscriptions: [SUB], expenses: [] }) } });
    const service = await fresh();
    expect((await service.getExpenseManagerData()).settings).toMatchObject({ defaultCurrency: 'USD', alertThresholdUSD: 300 });
  });

  it.each([
    ['no saved row', { data: null, error: null }],
    ['a read error', { data: null, error: { message: 'permission denied' } }],
    ['saved data without subscriptions', row({ expenses: [] })],
    ['saved data that is not JSON', { data: { value: '{oops' }, error: null }],
  ])('falls back to the seeded defaults on %s', async (_label, result) => {
    adminDb = createSupabaseMock({ tables: { AppSettings: result } });
    const service = await fresh();
    const data = await service.getExpenseManagerData();
    expect(data.subscriptions).toBe(service.DEFAULT_SUBSCRIPTIONS);
    expect(data.expenses).toBe(service.DEFAULT_EXPENSES);
    expect(data.settings).toBe(service.DEFAULT_CONFIG);
  });

  it('falls back to the seeded defaults without a database', async () => {
    dbBroken = true;
    const service = await fresh();
    expect((await service.getExpenseManagerData()).subscriptions).toBe((await import('@/lib/expenses/expense-service')).DEFAULT_SUBSCRIPTIONS);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('expense-service: saving', () => {
  it('saves the data to AppSettings under its key, stamped with the admin', async () => {
    const service = await fresh();
    expect(await service.saveExpenseManagerData(SAVED, 'boss@example.test')).toBe(true);
    expect(upserted()).toMatchObject({ key: 'expense_manager_data', updatedBy: 'boss@example.test' });
    expect(JSON.parse(upserted().value).settings).toMatchObject({ updatedBy: 'boss@example.test', alertThresholdUSD: 100 });
    // What was saved is what the next read returns, without the database
    expect((await service.getExpenseManagerData()).settings.updatedBy).toBe('boss@example.test');
    expect(adminDb.callsTo('AppSettings', 'select')).toHaveLength(0);
  });

  it('stamps "Admin" when no admin is named', async () => {
    const service = await fresh();
    await service.saveExpenseManagerData(SAVED);
    expect(upserted().updatedBy).toBe('Admin');
  });

  it('reports a failed save', async () => {
    adminDb = createSupabaseMock({ tables: { AppSettings: { data: null, error: { message: 'disk full' } } } });
    const service = await fresh();
    expect(await service.saveExpenseManagerData(SAVED, 'boss@example.test')).toBe(false);
    dbBroken = true;
    expect(await service.saveExpenseManagerData(SAVED, 'boss@example.test')).toBe(false);
  });
});

describe('expense-service: changes', () => {
  beforeEach(() => {
    adminDb = createSupabaseMock({ tables: { AppSettings: [row(SAVED), { data: null, error: null }] } });
  });

  it('adds an expense item with a new id and saves it', async () => {
    const service = await fresh();
    const item = await service.addExpenseItem(
      { subscriptionId: 'sub-1', title: 'Egress', type: 'charge', amount: 3, currency: 'USD', dueDate: '2026-11-20', category: 'database' },
      'boss@example.test',
    );
    expect(item.id).toMatch(/^exp-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
    expect(JSON.parse(upserted().value).expenses.map((e: { id: string }) => e.id)).toEqual(['e1', item.id]);
  });

  it('adds a subscription with a new id and timestamps, and saves it', async () => {
    const service = await fresh();
    const { id: _id, createdAt: _c, updatedAt: _u, ...input } = SUB;
    const sub = await service.addSubscription({ ...input, name: 'Brevo' }, 'boss@example.test');
    expect(sub).toMatchObject({ name: 'Brevo', id: expect.stringMatching(/^sub-/) });
    expect(sub.createdAt).toBe(sub.updatedAt);
    expect(JSON.parse(upserted().value).subscriptions).toHaveLength(2);
  });

  it('updates a subscription it has, and nothing for one it has not', async () => {
    const service = await fresh();
    expect(await service.updateSubscription('sub-1', { status: 'paused' }, 'boss@example.test')).toMatchObject({ id: 'sub-1', status: 'paused' });
    expect(JSON.parse(upserted().value).subscriptions[0].status).toBe('paused');
    const saves = adminDb.callsTo('AppSettings', 'upsert').length;
    expect(await service.updateSubscription('sub-404', { status: 'paused' }, 'boss@example.test')).toBeNull();
    expect(adminDb.callsTo('AppSettings', 'upsert')).toHaveLength(saves);
  });

  it("keeps a subscription's id and creation time, whatever the update says", async () => {
    const service = await fresh();
    const updated = await service.updateSubscription('sub-1', { id: 'other', createdAt: '2020-01-01T00:00:00Z', name: 'Renamed' }, 'boss@example.test');
    expect(updated).toMatchObject({ id: 'sub-1', createdAt: SUB.createdAt, name: 'Renamed' });
  });

  it('changes only the entry it names, leaving the others as they are', async () => {
    const other = { ...SUB, id: 'sub-2', name: 'Brevo' };
    const otherItem = { ...SAVED.expenses[0], id: 'e2', subscriptionId: 'sub-2' };
    adminDb = createSupabaseMock({ tables: { AppSettings: [row({ ...SAVED, subscriptions: [SUB, other], expenses: [...SAVED.expenses, otherItem] }), { data: null, error: null }] } });
    const service = await fresh();
    await service.updateSubscription('sub-1', { status: 'paused' }, 'boss@example.test');
    await service.updateExpenseItem('e1', { amount: 99 }, 'boss@example.test');
    const saved = JSON.parse(upserted().value) as ExpenseManagerData;
    expect(saved.subscriptions[1]).toEqual(other);
    expect(saved.expenses[1]).toEqual(otherItem);
    expect(saved.subscriptions[0].status).toBe('paused');
    expect(saved.expenses[0].amount).toBe(99);
  });

  it('deletes a subscription with its items, and nothing for one it has not', async () => {
    const service = await fresh();
    expect(await service.deleteSubscription('sub-404', 'boss@example.test')).toBe(false);
    expect(adminDb.callsTo('AppSettings', 'upsert')).toHaveLength(0);
    expect(await service.deleteSubscription('sub-1', 'boss@example.test')).toBe(true);
    expect(JSON.parse(upserted().value)).toMatchObject({ subscriptions: [], expenses: [] });
  });

  it('updates and deletes an expense item, keeping its id, and nothing for one it has not', async () => {
    const service = await fresh();
    expect(await service.updateExpenseItem('e1', { amount: 30, id: 'other' } as never, 'boss@example.test')).toMatchObject({ id: 'e1', amount: 30, title: 'Pro plan' });
    expect(JSON.parse(upserted().value).expenses[0]).toMatchObject({ id: 'e1', amount: 30 });
    expect(await service.updateExpenseItem('e404', { amount: 1 }, 'boss@example.test')).toBeNull();
    expect(await service.deleteExpenseItem('e404', 'boss@example.test')).toBe(false);
    expect(await service.deleteExpenseItem('e1', 'boss@example.test')).toBe(true);
    expect(JSON.parse(upserted().value).expenses).toEqual([]);
    expect(JSON.parse(upserted().value).subscriptions).toEqual([SUB]);
  });

  it('updates the settings, stamped with the admin', async () => {
    const service = await fresh();
    const settings = await service.updateExpenseSettings({ alertThresholdUSD: 50 }, 'boss@example.test');
    expect(settings).toMatchObject({ alertThresholdUSD: 50, exchangeRateUsdToPkr: 280, updatedBy: 'boss@example.test' });
    expect(JSON.parse(upserted().value).settings).toMatchObject({ alertThresholdUSD: 50 });
  });

  it('reports a change it could not save, and keeps the data as it was', async () => {
    adminDb = createSupabaseMock({ tables: { AppSettings: [row(SAVED), { data: null, error: { message: 'disk full' } }] } });
    const service = await fresh();
    const before = structuredClone(await service.getExpenseManagerData());
    const failed = 'The expense data could not be saved';
    await expect(service.addExpenseItem(SAVED.expenses[0], 'boss@example.test')).rejects.toThrow(failed);
    await expect(service.addSubscription(SUB, 'boss@example.test')).rejects.toThrow(failed);
    await expect(service.updateSubscription('sub-1', { status: 'paused' }, 'boss@example.test')).rejects.toThrow(failed);
    await expect(service.updateExpenseSettings({ alertThresholdUSD: 1 }, 'boss@example.test')).rejects.toThrow(failed);
    await expect(service.updateExpenseItem('e1', { amount: 1 }, 'boss@example.test')).rejects.toThrow(failed);
    await expect(service.deleteExpenseItem('e1', 'boss@example.test')).rejects.toThrow(failed);
    await expect(service.deleteSubscription('sub-1', 'boss@example.test')).rejects.toThrow(failed);
    expect(await service.getExpenseManagerData()).toEqual(before);
  });

  it('starts empty, and never changes the defaults it started from', async () => {
    adminDb = createSupabaseMock({ tables: { AppSettings: { data: null, error: null } } });
    const service = await fresh();
    const start = await service.getExpenseManagerData();
    expect(start).toMatchObject({ subscriptions: [], expenses: [] });
    const config = structuredClone(service.DEFAULT_CONFIG);
    const { id: _id, createdAt: _c, updatedAt: _u, ...input } = SUB;
    const sub = await service.addSubscription(input, 'boss@example.test');
    await service.addExpenseItem({ ...SAVED.expenses[0], subscriptionId: sub.id }, 'boss@example.test');
    await service.updateSubscription(sub.id, { status: 'paused' }, 'boss@example.test');
    await service.updateExpenseSettings({ alertThresholdUSD: 1 }, 'boss@example.test');
    expect(service.DEFAULT_SUBSCRIPTIONS).toEqual([]);
    expect(service.DEFAULT_EXPENSES).toEqual([]);
    expect(service.DEFAULT_CONFIG).toEqual(config);
    // The changes themselves were saved, one on top of the other
    const saved = JSON.parse(upserted().value) as ExpenseManagerData;
    expect(saved.subscriptions).toEqual([expect.objectContaining({ id: sub.id, status: 'paused' })]);
    expect(saved.expenses).toHaveLength(1);
    expect(saved.settings.alertThresholdUSD).toBe(1);
  });
});

describe('expense-service: the summary', () => {
  it('counts only active subscriptions, takes the earliest billing date, and uses the default rate', async () => {
    const service = await fresh();
    const groups = service.groupExpensesBySubscription(
      [
        { ...SUB, id: 'a', nextBillingDate: '2026-12-01' },
        { ...SUB, id: 'b', nextBillingDate: '' },
        { ...SUB, id: 'c', status: 'paused', nextBillingDate: '2026-11-01' },
      ],
      [{ ...SAVED.expenses[0], subscriptionId: 'a' }, { ...SAVED.expenses[0], subscriptionId: 'c' }],
    );
    const summary = service.calculateExpenseSummary(groups);
    expect(summary).toMatchObject({ totalActiveSubscriptions: 2, totalProjectedCostUSD: 25, nextUpcomingBillingDate: '2026-12-01' });
    expect(summary.totalProjectedCostPKR).toBe(Math.round(25 * summary.exchangeRateUsdToPkr));
    expect(service.calculateExpenseSummary([]).nextUpcomingBillingDate).toBeNull();
  });
});
