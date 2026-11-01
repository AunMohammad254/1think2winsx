'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  AlertTriangle,
  Receipt,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCSRFHeaders } from '@/lib/csrf';
import type {
  GroupedSubscriptionExpenses,
  ExpenseSummary,
  Subscription,
  ExpenseItem,
  ExpenseConfigSettings,
  ExpenseCategory,
} from '@/types/expense';
import ExpenseKPICards from './ExpenseKPICards';
import SubscriptionExpenseCard from './SubscriptionExpenseCard';
import AddExpenseModal from './AddExpenseModal';
import ExpenseSettingsModal from './ExpenseSettingsModal';

interface ExpenseManagerProps {
  initialSummary: ExpenseSummary;
  initialGroupedExpenses: GroupedSubscriptionExpenses[];
  initialSubscriptions: Subscription[];
  initialExpenses: ExpenseItem[];
  initialSettings: ExpenseConfigSettings;
}

const CATEGORIES: { id: ExpenseCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All Categories' },
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'database', label: 'Database' },
  { id: 'ai', label: 'AI Studio' },
  { id: 'email', label: 'Email Services' },
  { id: 'media', label: 'Media & Storage' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'security', label: 'Security' },
];

export default function ExpenseManager({
  initialSummary,
  initialGroupedExpenses,
  initialSubscriptions,
  initialExpenses,
  initialSettings,
}: ExpenseManagerProps) {
  const [summary, setSummary] = useState<ExpenseSummary>(initialSummary);
  const [groupedExpenses, setGroupedExpenses] =
    useState<GroupedSubscriptionExpenses[]>(initialGroupedExpenses);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(initialSubscriptions);
  const [_expenses, setExpenses] = useState<ExpenseItem[]>(initialExpenses);
  const [settings, setSettings] = useState<ExpenseConfigSettings>(initialSettings);

  const [currency, setCurrency] = useState<'USD' | 'PKR'>(initialSettings.defaultCurrency || 'USD');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedSubIdForAdd, setSelectedSubIdForAdd] = useState<string | undefined>();
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  const reloadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/expenses');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to refresh expense data');
      }
      setSummary(data.summary);
      setGroupedExpenses(data.groupedExpenses);
      setSubscriptions(data.subscriptions);
      setExpenses(data.expenses);
      setSettings(data.settings);
      toast.success('Expense data refreshed successfully');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Filtered groups
  const filteredGroups = useMemo(() => {
    return groupedExpenses.filter((group) => {
      const sub = group.subscription;
      const matchesCategory =
        selectedCategory === 'all' || sub.category === selectedCategory;

      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        sub.name.toLowerCase().includes(q) ||
        sub.provider.toLowerCase().includes(q) ||
        sub.planName.toLowerCase().includes(q) ||
        group.items.some((i) => i.title.toLowerCase().includes(q));

      return matchesCategory && matchesSearch;
    });
  }, [groupedExpenses, selectedCategory, search]);

  const handleOpenAddModal = (subId?: string) => {
    setSelectedSubIdForAdd(subId);
    setIsAddModalOpen(true);
  };

  const handleSettingsSaved = (updated: ExpenseConfigSettings) => {
    setSettings(updated);
    setCurrency(updated.defaultCurrency);
    // Recalculate summary exchange rate
    setSummary((prev) => ({
      ...prev,
      exchangeRateUsdToPkr: updated.exchangeRateUsdToPkr,
      totalProjectedCostPKR: Math.round(
        prev.totalProjectedCostUSD * updated.exchangeRateUsdToPkr
      ),
    }));
    toast.success('Settings updated');
  };

  const isOverBudget = summary.totalProjectedCostUSD > settings.alertThresholdUSD;

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumbs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
            <Link
              href="/admin/dashboard"
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Dashboard
            </Link>
            <span>/</span>
            <span className="text-gray-200">Expense Manager</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Receipt className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Expense Manager
              </h1>
              <p className="text-xs sm:text-sm text-gray-400 mt-0.5">
                All subscriptions, expected deductions, and scheduled charges for the upcoming
                billing cycle in one unified console.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Currency Toggle */}
          <div className="p-1 rounded-xl bg-gray-900 border border-white/10 flex items-center">
            <button
              onClick={() => setCurrency('USD')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                currency === 'USD'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              USD ($)
            </button>
            <button
              onClick={() => setCurrency('PKR')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                currency === 'PKR'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              PKR (₨)
            </button>
          </div>

          {/* Refresh Button */}
          <button
            onClick={reloadData}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors disabled:opacity-50"
            title="Refresh billing data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors"
            title="Configure exchange rate & budget threshold"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>

          {/* Add Expense Button */}
          <button
            onClick={() => handleOpenAddModal()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/20 transition-all hover:scale-[1.02]"
          >
            <Plus className="w-4 h-4" />
            <span>Add Expense</span>
          </button>
        </div>
      </div>

      {/* Budget Overrun Alert Banner if applicable */}
      {isOverBudget && (
        <div
          role="alert"
          className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-3.5 text-amber-200 text-sm"
        >
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block text-amber-100">
              Upcoming Cycle Budget Alert Exceeded
            </span>
            <p className="text-xs text-amber-200/80 mt-0.5">
              The projected net cost for this cycle (${summary.totalProjectedCostUSD.toFixed(2)})
              surpasses your configured alert threshold of ${settings.alertThresholdUSD.toFixed(2)}.
              Review individual subscription line items or apply available promotional deductions.
            </p>
          </div>
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 font-medium text-amber-100 shrink-0"
          >
            Adjust Threshold
          </button>
        </div>
      )}

      {/* Financial Overview KPIs */}
      <ExpenseKPICards summary={summary} currency={currency} />

      {/* Filter and Search Bar */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-4 shadow-md space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search subscription or line item..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-950/60 border border-white/10 rounded-xl text-white text-xs placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors"
            />
          </div>

          {/* Counts & Cycle Label */}
          <div className="text-xs text-gray-400 flex items-center gap-2 self-start sm:self-auto">
            <span>
              Showing <strong className="text-white">{filteredGroups.length}</strong> of{' '}
              {groupedExpenses.length} subscriptions
            </span>
            <span>•</span>
            <span className="text-purple-300 font-medium">{summary.billingPeriodLabel}</span>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-purple-600/20 text-purple-200 border border-purple-500/40'
                    : 'bg-white/[0.03] text-gray-400 border border-white/5 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Subscription Expense Groups */}
      <div className="space-y-5">
        {filteredGroups.length === 0 ? (
          <div className="p-12 text-center rounded-2xl border border-white/10 bg-gray-900/40 backdrop-blur-xl">
            <Receipt className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white">No subscriptions matched</h3>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
              No subscription or expense item found for &quot;{search}&quot;. Try clearing filters or
              add a new subscription entry.
            </p>
            <button
              onClick={() => {
                setSearch('');
                setSelectedCategory('all');
              }}
              className="mt-4 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 text-xs hover:bg-white/10"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          filteredGroups.map((group) => (
            <SubscriptionExpenseCard
              key={group.subscription.id}
              group={group}
              currency={currency}
              exchangeRate={summary.exchangeRateUsdToPkr}
              onAddItem={handleOpenAddModal}
            />
          ))
        )}
      </div>

      {/* Modals */}
      <AddExpenseModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setSelectedSubIdForAdd(undefined);
        }}
        subscriptions={subscriptions}
        defaultSubscriptionId={selectedSubIdForAdd}
        onExpenseAdded={reloadData}
        getCSRFHeaders={getCSRFHeaders}
      />

      <ExpenseSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onSettingsSaved={handleSettingsSaved}
        getCSRFHeaders={getCSRFHeaders}
      />
    </div>
  );
}

