'use client';

import React, { useState } from 'react';
import { X, Plus, AlertCircle, Loader2 } from 'lucide-react';
import type {
  Subscription,
  ExpenseItem,
  ExpenseCategory,
  ExpenseItemType,
  BillingCycle,
  SubscriptionStatus,
} from '@/types/expense';

/** An existing entry the modal edits instead of adding a new one */
export type EditTarget =
  | { kind: 'item'; item: ExpenseItem }
  | { kind: 'subscription'; subscription: Subscription };

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscriptions: Subscription[];
  defaultSubscriptionId?: string;
  /** The tab it opens on; without one, line items unless there is no subscription to add them to */
  initialTab?: 'item' | 'subscription';
  editing?: EditTarget | null;
  /** After a save the server accepted */
  onSaved: () => Promise<void>;
  getCSRFHeaders: () => Promise<Record<string, string>>;
}

const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

const CATEGORY_OPTIONS = (
  <>
    <option value="infrastructure">Infrastructure</option>
    <option value="database">Database</option>
    <option value="ai">AI / LLM</option>
    <option value="email">Email</option>
    <option value="media">Media & Assets</option>
    <option value="monitoring">Monitoring</option>
    <option value="security">Security</option>
    <option value="domain">Domain</option>
    <option value="other">Other</option>
  </>
);

function SubmitButton({ loading, label, busyLabel }: { loading: boolean; label: string; busyLabel: string }) {
  return (
    <div className="pt-2">
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{busyLabel}</span>
          </>
        ) : (
          <>
            <Plus className="w-4 h-4" />
            <span>{label}</span>
          </>
        )}
      </button>
    </div>
  );
}

/**
 * Adds a line item (charge or deduction) or a subscription, or edits an existing one (`editing`). The
 * parent mounts it afresh for every opening, so its fields start from what it is opened for.
 */
export default function AddExpenseModal({
  isOpen,
  onClose,
  subscriptions,
  defaultSubscriptionId,
  initialTab,
  editing,
  onSaved,
  getCSRFHeaders,
}: AddExpenseModalProps) {
  const item = editing?.kind === 'item' ? editing.item : null;
  const sub = editing?.kind === 'subscription' ? editing.subscription : null;

  const [tab, setTab] = useState<'item' | 'subscription'>(
    editing?.kind ?? initialTab ?? (subscriptions.length > 0 ? 'item' : 'subscription')
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Item form state
  const [subscriptionId, setSubscriptionId] = useState(
    item?.subscriptionId ?? defaultSubscriptionId ?? subscriptions[0]?.id ?? ''
  );
  const [title, setTitle] = useState(item?.title ?? '');
  const [type, setType] = useState<ExpenseItemType>(item?.type ?? 'charge');
  const [amount, setAmount] = useState(item ? String(item.amount) : '');
  const [dueDate, setDueDate] = useState(item?.dueDate ?? inDays(14));
  const [category, setCategory] = useState<ExpenseCategory>(item?.category ?? 'infrastructure');
  const [notes, setNotes] = useState(item?.notes ?? '');

  // Subscription form state
  const [subName, setSubName] = useState(sub?.name ?? '');
  const [subProvider, setSubProvider] = useState(sub?.provider ?? '');
  const [subPlanName, setSubPlanName] = useState(sub?.planName ?? '');
  const [subCategory, setSubCategory] = useState<ExpenseCategory>(sub?.category ?? 'infrastructure');
  const [subBillingCycle, setSubBillingCycle] = useState<BillingCycle>(sub?.billingCycle ?? 'monthly');
  const [subNextBillingDate, setSubNextBillingDate] = useState(sub?.nextBillingDate ?? inDays(30));
  const [subStatus, setSubStatus] = useState<SubscriptionStatus>(sub?.status ?? 'active');
  const [subAutoRenew, setSubAutoRenew] = useState(sub?.autoRenew ?? true);
  const [subPaymentMethod, setSubPaymentMethod] = useState(sub?.paymentMethod ?? 'Corporate Card');
  const [subPortalUrl, setSubPortalUrl] = useState(sub?.portalUrl ?? '');
  const [subDescription, setSubDescription] = useState(sub?.description ?? '');

  if (!isOpen) return null;

  const save = async (method: 'POST' | 'PUT', body: unknown, failure: string) => {
    setLoading(true);
    try {
      const csrfHeaders = await getCSRFHeaders();
      const res = await fetch('/api/admin/expenses', {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || failure);
      }

      await onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount greater than 0.');
      return;
    }
    if (!subscriptionId) {
      setError('Please select an associated subscription.');
      return;
    }

    const data = { subscriptionId, title: title.trim(), type, amount: parsedAmount, dueDate, category };
    await (item
      // An edit sends empty notes too, so clearing them sticks
      ? save('PUT', { entity: 'expense_item', id: item.id, data: { ...data, notes: notes.trim() } }, 'Failed to save changes')
      : save('POST', { entity: 'expense_item', data: { ...data, currency: 'USD', notes: notes.trim() || undefined } }, 'Failed to add expense item'));
  };

  const handleSubmitSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!subName.trim() || !subProvider.trim()) {
      setError('Subscription name and provider are required.');
      return;
    }

    const data = {
      name: subName.trim(),
      provider: subProvider.trim(),
      planName: subPlanName.trim() || 'Standard Tier',
      category: subCategory,
      billingCycle: subBillingCycle,
      nextBillingDate: subNextBillingDate,
      paymentMethod: subPaymentMethod.trim() || 'Corporate Card',
      status: subStatus,
      autoRenew: subAutoRenew,
    };
    await (sub
      ? save('PUT', {
          entity: 'subscription',
          id: sub.id,
          data: { ...data, portalUrl: subPortalUrl.trim(), description: subDescription.trim() },
        }, 'Failed to save changes')
      : save('POST', {
          entity: 'subscription',
          data: {
            ...data,
            portalUrl: subPortalUrl.trim() || undefined,
            description: subDescription.trim() || undefined,
            currency: 'USD',
          },
        }, 'Failed to add subscription'));
  };

  const inputClass =
    'w-full px-3 py-2 bg-gray-950/60 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors';
  const labelClass = 'block text-xs font-medium text-gray-300 mb-1';
  const heading = item ? 'Edit Line Item' : sub ? 'Edit Subscription' : 'Add Expense or Subscription';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-gray-900 border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-white">{heading}</h2>
            <p className="text-xs text-gray-400">
              {editing ? 'Change what is recorded for the upcoming cycle' : 'Record upcoming charges or discounts'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch: not while editing, which is one kind of entry */}
        {!editing && (
          <div className="grid grid-cols-2 p-1.5 mx-6 mt-4 bg-gray-950/50 border border-white/10 rounded-xl">
            <button
              type="button"
              onClick={() => setTab('item')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                tab === 'item'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Add Line Item (Charge/Deduction)
            </button>
            <button
              type="button"
              onClick={() => setTab('subscription')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                tab === 'subscription'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Add New Subscription
            </button>
          </div>
        )}

        {/* Error notification */}
        {error && (
          <div className="mx-6 mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-xs text-red-200">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Forms Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {tab === 'item' ? (
            <form onSubmit={handleSubmitItem} className="space-y-4">
              <div>
                <label className={labelClass}>Associated Subscription</label>
                <select
                  value={subscriptionId}
                  onChange={(e) => setSubscriptionId(e.target.value)}
                  className={inputClass}
                  required
                >
                  {subscriptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.provider})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Entry Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as ExpenseItemType)}
                    className={inputClass}
                  >
                    <option value="charge">Charge (+ Upcoming Fee)</option>
                    <option value="deduction">Deduction / Discount (- Credit)</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Amount (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="29.99"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Item Title / Description</label>
                <input
                  type="text"
                  placeholder="e.g. Monthly Standard License or Compute Discount"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass}>Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className={inputClass}
                  >
                    {CATEGORY_OPTIONS}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Additional context about this charge or discount..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={inputClass}
                />
              </div>

              <SubmitButton
                loading={loading}
                label={item ? 'Save Changes' : 'Add Line Item'}
                busyLabel={item ? 'Saving Changes...' : 'Saving Line Item...'}
              />
            </form>
          ) : (
            <form onSubmit={handleSubmitSubscription} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Subscription Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Supabase Pro"
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass}>Provider</label>
                  <input
                    type="text"
                    placeholder="e.g. Supabase Inc."
                    value={subProvider}
                    onChange={(e) => setSubProvider(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Plan / Tier</label>
                  <input
                    type="text"
                    placeholder="e.g. Standard Tier"
                    value={subPlanName}
                    onChange={(e) => setSubPlanName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Category</label>
                  <select
                    value={subCategory}
                    onChange={(e) => setSubCategory(e.target.value as ExpenseCategory)}
                    className={inputClass}
                  >
                    {CATEGORY_OPTIONS}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Billing Cycle</label>
                  <select
                    value={subBillingCycle}
                    onChange={(e) => setSubBillingCycle(e.target.value as BillingCycle)}
                    className={inputClass}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Next Renewal Date</label>
                  <input
                    type="date"
                    value={subNextBillingDate}
                    onChange={(e) => setSubNextBillingDate(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Status</label>
                  <select
                    value={subStatus}
                    onChange={(e) => setSubStatus(e.target.value as SubscriptionStatus)}
                    className={inputClass}
                  >
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="canceling">Canceling</option>
                    <option value="paused">Paused</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-gray-300">
                  <input
                    type="checkbox"
                    checked={subAutoRenew}
                    onChange={(e) => setSubAutoRenew(e.target.checked)}
                    className="w-4 h-4 rounded text-purple-600"
                  />
                  Renews automatically
                </label>
              </div>

              <div>
                <label className={labelClass}>Payment Method</label>
                <input
                  type="text"
                  placeholder="e.g. Corporate Visa ending in 9821"
                  value={subPaymentMethod}
                  onChange={(e) => setSubPaymentMethod(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Billing Portal URL (Optional)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={subPortalUrl}
                  onChange={(e) => setSubPortalUrl(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Notes on usage or project role"
                  value={subDescription}
                  onChange={(e) => setSubDescription(e.target.value)}
                  className={inputClass}
                />
              </div>

              <SubmitButton
                loading={loading}
                label={sub ? 'Save Changes' : 'Create Subscription'}
                busyLabel={sub ? 'Saving Changes...' : 'Creating Subscription...'}
              />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
