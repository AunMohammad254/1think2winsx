import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import type { ExpenseConfigSettings, ExpenseSummary, GroupedSubscriptionExpenses, Subscription } from '@/types/expense';

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: async () => ({ 'X-CSRF-Token': 'tok' }) }));

import ExpenseManager from '@/components/admin/expenses/ExpenseManager';
import AddExpenseModal from '@/components/admin/expenses/AddExpenseModal';
import ExpenseSettingsModal from '@/components/admin/expenses/ExpenseSettingsModal';
import SubscriptionExpenseCard from '@/components/admin/expenses/SubscriptionExpenseCard';
import ExpenseKPICards from '@/components/admin/expenses/ExpenseKPICards';
import ExpenseManagerLoading from '@/app/admin/(protected)/expenses/loading';

const SUB: Subscription = {
  id: 'sub-1', name: 'Cloud Plan', provider: 'Cloud Host Inc.', category: 'infrastructure', billingCycle: 'monthly',
  nextBillingDate: '2026-11-20', status: 'active', currency: 'USD', autoRenew: true, paymentMethod: 'Visa 4242',
  planName: 'Enterprise', portalUrl: 'https://cloudhost.example/billing', description: 'Main VPS',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
};
const DB: Subscription = { ...SUB, id: 'sub-2', name: 'Database', provider: 'Supabase Inc.', category: 'database', planName: 'Pro' };
const groupOf = (subscription: Subscription, title = 'Monthly fee'): GroupedSubscriptionExpenses => ({
  subscription,
  items: [{ id: `i-${subscription.id}`, subscriptionId: subscription.id, title, type: 'charge', amount: 20, currency: 'USD', dueDate: '2026-11-20', category: subscription.category }],
  totalCharges: 20, totalDeductions: 0, netTotal: 20,
});
const SUMMARY: ExpenseSummary = {
  totalProjectedCostUSD: 40, totalProjectedCostPKR: 11140, totalChargesUSD: 40, totalDeductionsUSD: 0, totalActiveSubscriptions: 2,
  nextUpcomingBillingDate: '2026-11-20', exchangeRateUsdToPkr: 278.5, billingPeriodLabel: 'November 2026 Billing Cycle',
};
const SETTINGS: ExpenseConfigSettings = { defaultCurrency: 'USD', alertThresholdUSD: 300, enableRenewalReminders: true, exchangeRateUsdToPkr: 278.5 };
const csrf = async () => ({ 'X-CSRF-Token': 'tok' });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);
const deferred = () => {
  let resolve!: (res: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('ExpenseManager', () => {
  const renderManager = (settings: Partial<ExpenseConfigSettings> = {}) => render(
    <ExpenseManager
      initialSummary={SUMMARY}
      initialGroupedExpenses={[groupOf(SUB), groupOf(DB, 'Egress credit')]}
      initialSubscriptions={[SUB, DB]}
      initialExpenses={[]}
      initialSettings={{ ...SETTINGS, ...settings }}
    />
  );
  const shown = () => screen.queryAllByText(/^Subscription: /).map((el) => el.textContent);

  it('refreshes from the API, and says why when it cannot', async () => {
    renderManager();
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true, summary: { ...SUMMARY, billingPeriodLabel: 'December 2026 Billing Cycle' }, groupedExpenses: [groupOf(DB)],
      subscriptions: [DB], expenses: [], settings: SETTINGS,
    }));
    fireEvent.click(screen.getByTitle('Refresh billing data'));
    expect(screen.getByTitle('Refresh billing data')).toBeDisabled();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Expense data refreshed successfully'));
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/expenses');
    expect(shown()).toEqual(['Subscription: Database']);
    expect(screen.getAllByText('December 2026 Billing Cycle').length).toBeGreaterThanOrEqual(1);

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, error: 'Unauthorized. Admin session required.' }, 401));
    fireEvent.click(screen.getByTitle('Refresh billing data'));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Unauthorized. Admin session required.'));
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false }));
    fireEvent.click(screen.getByTitle('Refresh billing data'));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to refresh expense data'));
    expect(screen.getByTitle('Refresh billing data')).toBeEnabled();
  });

  it('filters by category and by provider, plan or line item, and resets the filters', () => {
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: 'Database' }));
    expect(shown()).toEqual(['Subscription: Database']);
    fireEvent.click(screen.getByRole('button', { name: 'All Categories' }));
    const search = screen.getByPlaceholderText(/Search subscription or line item/);
    for (const [query, expected] of [['cloud host', 'Cloud Plan'], ['enterprise', 'Cloud Plan'], ['egress', 'Database']]) {
      fireEvent.change(search, { target: { value: query } });
      expect(shown()).toEqual([`Subscription: ${expected}`]);
    }
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No subscriptions matched')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }));
    expect(shown()).toHaveLength(2);
    expect(search).toHaveValue('');
  });

  it('opens Add Expense from the header and for one subscription, and closes it', () => {
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));
    expect(screen.getByRole('heading', { name: 'Add Expense or Subscription' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('heading', { name: 'Add Expense or Subscription' }).closest('div.flex')!).getByRole('button'));
    expect(screen.queryByRole('heading', { name: 'Add Expense or Subscription' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Item' })[1]);
    expect(screen.getByRole('heading', { name: 'Add Expense or Subscription' })).toBeInTheDocument();
  });

  it('opens Add Item on the subscription it was clicked for, and every opening starts afresh', () => {
    renderManager();
    const heading = () => screen.getByRole('heading', { name: 'Add Expense or Subscription' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Item' })[1]);
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('sub-2');
    fireEvent.change(screen.getByPlaceholderText('29.99'), { target: { value: '7' } });
    fireEvent.click(within(heading().closest('div.flex')!).getByRole('button'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Item' })[0]);
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('sub-1');
    expect(screen.getByPlaceholderText('29.99')).toHaveValue(null);
    fireEvent.click(within(heading().closest('div.flex')!).getByRole('button'));
    // From the header: the first subscription
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Item' })[1]);
    fireEvent.click(within(heading().closest('div.flex')!).getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('sub-1');
  });

  it('opens the settings as last loaded, not as they were when the page opened', async () => {
    const { container } = renderManager();
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true, summary: SUMMARY, groupedExpenses: [groupOf(SUB)], subscriptions: [SUB], expenses: [],
      settings: { ...SETTINGS, alertThresholdUSD: 150 },
    }));
    fireEvent.click(screen.getByTitle('Refresh billing data'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Expense data refreshed successfully'));
    fireEvent.click(screen.getByTitle('Configure exchange rate & budget threshold'));
    expect(container.querySelectorAll('input[type="number"]')[1]).toHaveValue(150);
  });

  it('refreshes once an expense is added', async () => {
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));
    fireEvent.change(screen.getByPlaceholderText('29.99'), { target: { value: '12' } });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, item: { id: 'new' } }, 201))
      .mockResolvedValueOnce(jsonResponse({ success: true, summary: SUMMARY, groupedExpenses: [], subscriptions: [], expenses: [], settings: SETTINGS }));
    fireEvent.submit(screen.getByRole('button', { name: 'Add Line Item' }).closest('form')!);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Expense data refreshed successfully'));
    expect(screen.queryByRole('heading', { name: 'Add Expense or Subscription' })).toBeNull();
  });

  it('warns over budget, opens the settings from the warning, and applies saved settings', async () => {
    renderManager({ alertThresholdUSD: 30, defaultCurrency: undefined as never });
    expect(screen.getByRole('alert')).toHaveTextContent('($40.00) surpasses your configured alert threshold of $30.00');
    fireEvent.click(screen.getByRole('button', { name: 'Adjust Threshold' }));
    expect(screen.getByRole('heading', { name: 'Expense Manager Settings' })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, settings: { ...SETTINGS, defaultCurrency: 'PKR', exchangeRateUsdToPkr: 300, alertThresholdUSD: 100 } }));
    fireEvent.submit(screen.getByRole('button', { name: 'Save Settings' }).closest('form')!);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Settings updated'));
    // PKR at the new rate, and no longer over budget
    expect(screen.getAllByText('₨ 12,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'USD ($)' }));
    expect(screen.getAllByText('$40.00').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByTitle('Configure exchange rate & budget threshold'));
    expect(screen.getByRole('heading', { name: 'Expense Manager Settings' })).toBeInTheDocument();
  });
});

describe('AddExpenseModal', () => {
  const setup = (props: Partial<Parameters<typeof AddExpenseModal>[0]> = {}) => {
    const onClose = vi.fn();
    const onExpenseAdded = vi.fn(async () => {});
    const utils = render(
      <AddExpenseModal isOpen onClose={onClose} subscriptions={[SUB, DB]} onExpenseAdded={onExpenseAdded} getCSRFHeaders={csrf} {...props} />
    );
    return { ...utils, onClose, onExpenseAdded };
  };
  const itemForm = () => screen.getByPlaceholderText('29.99').closest('form')!;

  it('renders nothing while closed', () => {
    const { container } = setup({ isOpen: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('checks the amount and the subscription before sending', () => {
    setup();
    fireEvent.submit(itemForm());
    expect(screen.getByText('Please enter a valid amount greater than 0.')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('29.99'), { target: { value: '0' } });
    fireEvent.submit(itemForm());
    expect(screen.getByText('Please enter a valid amount greater than 0.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs a subscription to add an item to', () => {
    setup({ subscriptions: [] });
    fireEvent.change(screen.getByPlaceholderText('29.99'), { target: { value: '5' } });
    fireEvent.submit(itemForm());
    expect(screen.getByText('Please select an associated subscription.')).toBeInTheDocument();
  });

  it('sends a line item with every field, then refreshes and closes', async () => {
    const { onClose, onExpenseAdded, container } = setup({ defaultSubscriptionId: 'sub-2' });
    const [subscription, type, category] = screen.getAllByRole('combobox');
    expect(subscription).toHaveValue('sub-2');
    fireEvent.change(subscription, { target: { value: 'sub-1' } });
    fireEvent.change(type, { target: { value: 'deduction' } });
    fireEvent.change(category, { target: { value: 'security' } });
    fireEvent.change(screen.getByPlaceholderText('29.99'), { target: { value: '5.5' } });
    fireEvent.change(screen.getByPlaceholderText(/Monthly Standard License/), { target: { value: '  Promo credit ' } });
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-12-05' } });
    fireEvent.change(screen.getByPlaceholderText(/Additional context/), { target: { value: ' first month ' } });
    const reply = deferred();
    fetchMock.mockReturnValueOnce(reply.promise);
    fireEvent.submit(itemForm());
    expect(await screen.findByText('Saving Line Item...')).toBeInTheDocument();
    reply.resolve(jsonResponse({ success: true, item: { id: 'new' } }, 201));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onExpenseAdded).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/expenses');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'tok' });
    expect(sentBody()).toEqual({
      entity: 'expense_item',
      data: { subscriptionId: 'sub-1', title: 'Promo credit', type: 'deduction', amount: 5.5, currency: 'USD', dueDate: '2026-12-05', category: 'security', notes: 'first month' },
    });
    // The form starts empty again
    expect(screen.getByPlaceholderText('29.99')).toHaveValue(null);
  });

  it('leaves out empty notes, and shows why an item was refused', async () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('29.99'), { target: { value: '9' } });
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, error: 'Invalid expense item payload' }, 400));
    fireEvent.submit(itemForm());
    expect(await screen.findByText('Invalid expense item payload')).toBeInTheDocument();
    expect(sentBody().data).toMatchObject({ subscriptionId: 'sub-1' });
    expect(sentBody().data).not.toHaveProperty('notes');
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false }));
    fireEvent.submit(itemForm());
    expect(await screen.findByText('Failed to add expense item')).toBeInTheDocument();
  });

  it('creates a subscription with the defaults, or as typed', async () => {
    const { onClose, onExpenseAdded, container } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add New Subscription' }));
    const form = () => screen.getByPlaceholderText('e.g. Supabase Pro').closest('form')!;
    fireEvent.submit(form());
    expect(screen.getByText('Subscription name and provider are required.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('e.g. Supabase Pro'), { target: { value: ' Brevo ' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Supabase Inc.'), { target: { value: 'Brevo SAS' } });
    fireEvent.change(screen.getByPlaceholderText(/Corporate Visa ending/), { target: { value: ' ' } });
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }, 201));
    fireEvent.submit(form());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onExpenseAdded).toHaveBeenCalledTimes(1);
    expect(sentBody(0).data).toMatchObject({
      name: 'Brevo', provider: 'Brevo SAS', planName: 'Standard Tier', category: 'infrastructure', billingCycle: 'monthly',
      paymentMethod: 'Corporate Card', currency: 'USD', status: 'active', autoRenew: true,
    });
    expect(sentBody(0).data).not.toHaveProperty('portalUrl');
    expect(sentBody(0).data).not.toHaveProperty('description');

    fireEvent.change(screen.getByPlaceholderText('e.g. Supabase Pro'), { target: { value: 'Sentry' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Supabase Inc.'), { target: { value: 'Functional Software' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Standard Tier'), { target: { value: 'Team' } });
    const [category, cycle] = screen.getAllByRole('combobox');
    fireEvent.change(category, { target: { value: 'monitoring' } });
    fireEvent.change(cycle, { target: { value: 'annual' } });
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2027-01-01' } });
    fireEvent.change(screen.getByPlaceholderText(/Corporate Visa ending/), { target: { value: 'Amex' } });
    fireEvent.change(screen.getByPlaceholderText('https://...'), { target: { value: 'https://sentry.example/billing' } });
    fireEvent.change(screen.getByPlaceholderText(/Notes on usage/), { target: { value: 'Errors' } });
    const reply = deferred();
    fetchMock.mockReturnValueOnce(reply.promise);
    fireEvent.submit(form());
    expect(await screen.findByText('Creating Subscription...')).toBeInTheDocument();
    reply.resolve(jsonResponse({ success: true }, 201));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(sentBody(1).data).toMatchObject({
      name: 'Sentry', planName: 'Team', category: 'monitoring', billingCycle: 'annual', nextBillingDate: '2027-01-01',
      paymentMethod: 'Amex', portalUrl: 'https://sentry.example/billing', description: 'Errors',
    });
  });

  it('shows why a subscription was refused, and switches back to line items', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add New Subscription' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Supabase Pro'), { target: { value: 'Brevo' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Supabase Inc.'), { target: { value: 'Brevo SAS' } });
    const form = screen.getByPlaceholderText('e.g. Supabase Pro').closest('form')!;
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, error: 'Invalid subscription payload' }, 400));
    fireEvent.submit(form);
    expect(await screen.findByText('Invalid subscription payload')).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false }));
    fireEvent.submit(form);
    expect(await screen.findByText('Failed to add subscription')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Line Item (Charge/Deduction)' }));
    expect(screen.getByPlaceholderText('29.99')).toBeInTheDocument();
  });
});

describe('ExpenseSettingsModal', () => {
  const setup = (isOpen = true) => {
    const onClose = vi.fn();
    const onSettingsSaved = vi.fn();
    const utils = render(<ExpenseSettingsModal isOpen={isOpen} onClose={onClose} settings={SETTINGS} onSettingsSaved={onSettingsSaved} getCSRFHeaders={csrf} />);
    return { ...utils, onClose, onSettingsSaved };
  };
  const form = () => screen.getByRole('button', { name: /Save Settings|Saving|Saved/ }).closest('form')!;

  it('renders nothing while closed, and closes from its X and Cancel', () => {
    const { container } = setup(false);
    expect(container).toBeEmptyDOMElement();
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(screen.getByRole('heading', { name: 'Expense Manager Settings' }).closest('div.justify-between')!).getAllByRole('button')[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('saves every setting, says so, then closes', async () => {
    const { onClose, onSettingsSaved, container } = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'PKR' } });
    const [rate, threshold] = container.querySelectorAll('input[type="number"]');
    fireEvent.change(rate, { target: { value: '281.25' } });
    fireEvent.change(threshold, { target: { value: '120' } });
    fireEvent.click(screen.getByRole('checkbox'));
    const reply = deferred();
    fetchMock.mockReturnValueOnce(reply.promise);
    fireEvent.submit(form());
    expect(await screen.findByText('Saving...')).toBeInTheDocument();
    const saved = { ...SETTINGS, defaultCurrency: 'PKR', exchangeRateUsdToPkr: 281.25, alertThresholdUSD: 120, enableRenewalReminders: false };
    reply.resolve(jsonResponse({ success: true, settings: saved }));
    expect(await screen.findByText('Saved!')).toBeInTheDocument();
    expect(onSettingsSaved).toHaveBeenCalledWith(saved);
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
    expect(sentBody()).toEqual({ entity: 'settings', data: { defaultCurrency: 'PKR', alertThresholdUSD: 120, exchangeRateUsdToPkr: 281.25, enableRenewalReminders: false } });
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.getByText('Save Settings')).toBeInTheDocument();
  });

  it('falls back to the default rate and threshold for empty boxes, and shows why a save failed', async () => {
    const { container, onSettingsSaved } = setup();
    for (const input of container.querySelectorAll('input[type="number"]')) fireEvent.change(input, { target: { value: '' } });
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, error: 'Invalid settings payload' }, 400));
    fireEvent.submit(form());
    expect(await screen.findByText('Invalid settings payload')).toBeInTheDocument();
    expect(sentBody().data).toMatchObject({ alertThresholdUSD: 300, exchangeRateUsdToPkr: 278.5 });
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false }));
    fireEvent.submit(form());
    expect(await screen.findByText('Failed to save configuration settings')).toBeInTheDocument();
    expect(onSettingsSaved).not.toHaveBeenCalled();
  });
});

describe('SubscriptionExpenseCard and the KPI cards', () => {
  it('shows a paused, manually renewed subscription without items, in PKR, and asks to add an item to it', () => {
    const onAddItem = vi.fn();
    const subscription = { ...SUB, status: 'paused', autoRenew: false, portalUrl: undefined, description: undefined, category: 'unknown' } as unknown as Subscription;
    render(<SubscriptionExpenseCard group={{ subscription, items: [], totalCharges: 10, totalDeductions: 2, netTotal: 8 }} currency="PKR" exchangeRate={300} onAddItem={onAddItem} />);
    expect(screen.getByText('paused')).toHaveClass('text-amber-400');
    expect(screen.getByText('Manual renewal')).toBeInTheDocument();
    expect(screen.queryByTitle('Open provider billing portal')).toBeNull();
    expect(screen.getByText('No scheduled charges or deductions recorded for this cycle.')).toBeInTheDocument();
    expect(screen.getByText('₨ 2,400')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));
    expect(onAddItem).toHaveBeenCalledWith('sub-1');
  });

  it('shows "None pending" without an upcoming billing date', () => {
    render(<ExpenseKPICards summary={{ ...SUMMARY, nextUpcomingBillingDate: null }} currency="USD" />);
    expect(screen.getByText(/None pending/)).toBeInTheDocument();
  });

  it('shows a skeleton while the page loads', () => {
    const { container } = render(<ExpenseManagerLoading />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
