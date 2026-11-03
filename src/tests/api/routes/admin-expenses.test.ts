// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { makeRequest } from '@/tests/helpers/supabase-mock';
import type { ExpenseManagerData, Subscription } from '@/types/expense';

const h = vi.hoisted(() => ({
  requireCSRFToken: vi.fn(),
  validateAdminSession: vi.fn(),
  requireAdminSession: vi.fn(),
  getExpenseManagerData: vi.fn(),
  addExpenseItem: vi.fn(),
  addSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  updateExpenseSettings: vi.fn(),
  updateExpenseItem: vi.fn(),
  deleteSubscription: vi.fn(),
  deleteExpenseItem: vi.fn(),
}));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => h.requireCSRFToken(...a) }));
vi.mock('@/lib/admin-session', () => ({
  validateAdminSession: () => h.validateAdminSession(),
  requireAdminSession: () => h.requireAdminSession(),
}));
vi.mock('@/lib/expenses/expense-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/expenses/expense-service')>()),
  getExpenseManagerData: () => h.getExpenseManagerData(),
  addExpenseItem: (...a: unknown[]) => h.addExpenseItem(...a),
  addSubscription: (...a: unknown[]) => h.addSubscription(...a),
  updateSubscription: (...a: unknown[]) => h.updateSubscription(...a),
  updateExpenseSettings: (...a: unknown[]) => h.updateExpenseSettings(...a),
  updateExpenseItem: (...a: unknown[]) => h.updateExpenseItem(...a),
  deleteSubscription: (...a: unknown[]) => h.deleteSubscription(...a),
  deleteExpenseItem: (...a: unknown[]) => h.deleteExpenseItem(...a),
}));

import { DELETE, GET, POST, PUT } from '@/app/api/admin/expenses/route';
import { getExpenseDashboardData } from '@/actions/expense-actions';

const ADMIN = 'boss@example.test';
const SUB: Subscription = {
  id: 'sub-1', name: 'Supabase Pro', provider: 'Supabase Inc.', category: 'database', billingCycle: 'monthly',
  nextBillingDate: '2026-11-20', status: 'active', currency: 'USD', autoRenew: true, paymentMethod: 'Visa',
  planName: 'Pro', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const DATA: ExpenseManagerData = {
  subscriptions: [SUB],
  expenses: [{ id: 'e1', subscriptionId: 'sub-1', title: 'Pro plan', type: 'charge', amount: 25, currency: 'USD', dueDate: '2026-11-20', category: 'database' }],
  settings: { defaultCurrency: 'USD', alertThresholdUSD: 300, enableRenewalReminders: true, exchangeRateUsdToPkr: 280 },
};
const ITEM = { subscriptionId: 'sub-1', title: 'Egress', type: 'charge', amount: 3, dueDate: '2026-11-20', category: 'database' };
const NEW_SUB = { name: 'Brevo', provider: 'Brevo SAS', category: 'email', billingCycle: 'monthly', nextBillingDate: '2026-12-01', paymentMethod: 'Visa', planName: 'Starter' };

const post = (body: unknown) => POST(makeRequest('/api/admin/expenses', { method: 'POST', body }));
const put = (body: unknown) => PUT(makeRequest('/api/admin/expenses', { method: 'PUT', body }));
const del = (body: unknown) => DELETE(makeRequest('/api/admin/expenses', { method: 'DELETE', body }));

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.requireCSRFToken.mockResolvedValue(null);
  h.validateAdminSession.mockResolvedValue({ valid: true, email: ADMIN });
  h.requireAdminSession.mockResolvedValue(ADMIN);
  h.getExpenseManagerData.mockResolvedValue(DATA);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/admin/expenses', () => {
  it('answers 500 when the data cannot be read', async () => {
    h.getExpenseManagerData.mockRejectedValueOnce(new Error('down'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to retrieve expenses' });
  });
});

describe('POST /api/admin/expenses', () => {
  it('refuses a request without a valid CSRF token, before anything else', async () => {
    h.requireCSRFToken.mockResolvedValueOnce(NextResponse.json({ error: 'csrf' }, { status: 403 }));
    expect((await post({ entity: 'expense_item', data: ITEM })).status).toBe(403);
    expect(h.validateAdminSession).not.toHaveBeenCalled();
  });

  it('refuses anyone who is not an admin', async () => {
    h.validateAdminSession.mockResolvedValueOnce({ valid: true });
    expect((await post({ entity: 'expense_item', data: ITEM })).status).toBe(401);
    h.validateAdminSession.mockResolvedValueOnce({ valid: false, email: ADMIN });
    expect((await post({ entity: 'expense_item', data: ITEM })).status).toBe(401);
    expect(h.addExpenseItem).not.toHaveBeenCalled();
  });

  it('adds an expense item, in USD unless it says otherwise', async () => {
    h.addExpenseItem.mockResolvedValueOnce({ id: 'e2', ...ITEM });
    const res = await post({ entity: 'expense_item', data: ITEM });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, item: { id: 'e2', ...ITEM } });
    expect(h.addExpenseItem).toHaveBeenCalledWith({ ...ITEM, currency: 'USD' }, ADMIN);
  });

  it('refuses an invalid expense item', async () => {
    const res = await post({ entity: 'expense_item', data: { ...ITEM, amount: -1 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid expense item payload');
  });

  it('adds a subscription, with the defaults filled in', async () => {
    h.addSubscription.mockResolvedValueOnce({ id: 'sub-2', ...NEW_SUB });
    const res = await post({ entity: 'subscription', data: { ...NEW_SUB, portalUrl: '' } });
    expect(res.status).toBe(201);
    expect(h.addSubscription).toHaveBeenCalledWith({ ...NEW_SUB, portalUrl: '', status: 'active', currency: 'USD', autoRenew: true }, ADMIN);
  });

  it('refuses an invalid subscription, and an unknown entity', async () => {
    const bad = await post({ entity: 'subscription', data: { ...NEW_SUB, portalUrl: 'not a url' } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Invalid subscription payload');
    const unknown = await post({ entity: 'invoice', data: {} });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toMatch(/Invalid entity type/);
  });

  it('answers 500 when the body cannot be read', async () => {
    const res = await POST(makeRequest('/api/admin/expenses', { method: 'POST', rawBody: 'not json' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to create expense entry');
  });
});

describe('PUT /api/admin/expenses', () => {
  it('refuses a request without a valid CSRF token, and anyone who is not an admin', async () => {
    h.requireCSRFToken.mockResolvedValueOnce(NextResponse.json({ error: 'csrf' }, { status: 403 }));
    expect((await put({ entity: 'settings', data: {} })).status).toBe(403);
    h.validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await put({ entity: 'settings', data: {} })).status).toBe(401);
    expect(h.updateExpenseSettings).not.toHaveBeenCalled();
  });

  it('updates the settings, and refuses invalid ones', async () => {
    h.updateExpenseSettings.mockResolvedValueOnce({ ...DATA.settings, alertThresholdUSD: 50 });
    const res = await put({ entity: 'settings', data: { alertThresholdUSD: 50 } });
    expect(res.status).toBe(200);
    expect((await res.json()).settings.alertThresholdUSD).toBe(50);
    expect(h.updateExpenseSettings).toHaveBeenCalledWith({ alertThresholdUSD: 50 }, ADMIN);
    const bad = await put({ entity: 'settings', data: { exchangeRateUsdToPkr: 0 } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Invalid settings payload');
  });

  it('updates only the fields a subscription change names, and answers 404 for one that does not exist', async () => {
    h.updateSubscription.mockResolvedValueOnce({ ...SUB, status: 'paused' });
    const res = await put({ entity: 'subscription', id: 'sub-1', data: { status: 'paused' } });
    expect(res.status).toBe(200);
    expect((await res.json()).subscription.status).toBe('paused');
    // No defaults filled in: currency and auto-renew stay as they are
    expect(h.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'paused' }, ADMIN);
    h.updateSubscription.mockResolvedValueOnce(null);
    expect((await put({ entity: 'subscription', id: 'sub-404', data: {} })).status).toBe(404);
  });

  it('refuses a subscription change with a bad value or a field it may not change', async () => {
    for (const data of [{ status: 'gone' }, { id: 'other' }, { createdAt: '2020-01-01' }]) {
      const res = await put({ entity: 'subscription', id: 'sub-1', data });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Invalid subscription payload');
    }
    expect(h.updateSubscription).not.toHaveBeenCalled();
  });

  it('updates an expense item, refuses a bad one, and answers 404 for one that does not exist', async () => {
    h.updateExpenseItem.mockResolvedValueOnce({ id: 'e1', ...ITEM, amount: 4 });
    const res = await put({ entity: 'expense_item', id: 'e1', data: { amount: 4, notes: '' } });
    expect(res.status).toBe(200);
    expect((await res.json()).item.amount).toBe(4);
    expect(h.updateExpenseItem).toHaveBeenCalledWith('e1', { amount: 4, notes: '' }, ADMIN);
    const bad = await put({ entity: 'expense_item', id: 'e1', data: { amount: 0 } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Invalid expense item payload');
    h.updateExpenseItem.mockResolvedValueOnce(null);
    const missing = await put({ entity: 'expense_item', id: 'e404', data: { amount: 4 } });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe('Expense item not found');
  });

  it('refuses an update it does not know, and answers 500 when the body cannot be read', async () => {
    expect((await put({ entity: 'subscription', data: {} })).status).toBe(400);
    const res = await PUT(makeRequest('/api/admin/expenses', { method: 'PUT', rawBody: 'not json' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to update expense entry');
  });
});

describe('DELETE /api/admin/expenses', () => {
  it('refuses a request without a valid CSRF token, and anyone who is not an admin', async () => {
    h.requireCSRFToken.mockResolvedValueOnce(NextResponse.json({ error: 'csrf' }, { status: 403 }));
    expect((await del({ entity: 'subscription', id: 'sub-1' })).status).toBe(403);
    h.validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await del({ entity: 'subscription', id: 'sub-1' })).status).toBe(401);
    expect(h.deleteSubscription).not.toHaveBeenCalled();
  });

  it('deletes a subscription or an expense item as the signed-in admin', async () => {
    h.deleteSubscription.mockResolvedValueOnce(true);
    const res = await del({ entity: 'subscription', id: 'sub-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(h.deleteSubscription).toHaveBeenCalledWith('sub-1', ADMIN);
    h.deleteExpenseItem.mockResolvedValueOnce(true);
    expect((await del({ entity: 'expense_item', id: 'e1' })).status).toBe(200);
    expect(h.deleteExpenseItem).toHaveBeenCalledWith('e1', ADMIN);
  });

  it('answers 404 for one that does not exist, 400 for a bad request, and 500 when it fails', async () => {
    h.deleteSubscription.mockResolvedValueOnce(false);
    const sub = await del({ entity: 'subscription', id: 'sub-404' });
    expect(sub.status).toBe(404);
    expect((await sub.json()).error).toBe('Subscription not found');
    h.deleteExpenseItem.mockResolvedValueOnce(false);
    expect((await (await del({ entity: 'expense_item', id: 'e404' })).json()).error).toBe('Expense item not found');
    const bad = await del({ entity: 'settings', id: 'x' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Invalid delete request');
    h.deleteExpenseItem.mockRejectedValueOnce(new Error('The expense data could not be saved'));
    const failed = await del({ entity: 'expense_item', id: 'e1' });
    expect(failed.status).toBe(500);
    expect((await failed.json()).error).toBe('Failed to delete expense entry');
  });
});

describe('expense server actions', () => {
  it('builds the dashboard for an admin', async () => {
    const data = await getExpenseDashboardData();
    expect(h.requireAdminSession).toHaveBeenCalled();
    expect(data.groupedExpenses[0]).toMatchObject({ netTotal: 25, items: DATA.expenses });
    expect(data.summary).toMatchObject({ totalProjectedCostUSD: 25, totalProjectedCostPKR: 7000 });
    expect(data.settings).toBe(DATA.settings);
  });
});
