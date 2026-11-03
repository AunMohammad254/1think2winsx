'use client';

import React from 'react';
import {
  ExternalLink,
  CreditCard,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Plus,
  Server,
  Database,
  Cpu,
  Mail,
  Image as ImageIcon,
  ShieldAlert,
  Globe,
  Radio,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { GroupedSubscriptionExpenses, ExpenseCategory, ExpenseItem, Subscription } from '@/types/expense';
import ExpenseItemRow from './ExpenseItemRow';

interface SubscriptionExpenseCardProps {
  group: GroupedSubscriptionExpenses;
  currency: 'USD' | 'PKR';
  exchangeRate: number;
  onAddItem: (subscriptionId: string) => void;
  onEdit: (subscription: Subscription) => void;
  /** Removes the subscription and its items */
  onDelete: (group: GroupedSubscriptionExpenses) => void;
  onEditItem: (item: ExpenseItem) => void;
  onDeleteItem: (item: ExpenseItem) => void;
}

const CATEGORY_ICONS: Record<ExpenseCategory, React.ElementType> = {
  infrastructure: Server,
  database: Database,
  ai: Cpu,
  email: Mail,
  media: ImageIcon,
  monitoring: Radio,
  security: ShieldAlert,
  domain: Globe,
  other: Server,
};

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  infrastructure: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  database: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  ai: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  email: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  media: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20',
  monitoring: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  security: 'text-red-400 bg-red-500/10 border-red-500/20',
  domain: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  other: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
};

export default function SubscriptionExpenseCard({
  group,
  currency,
  exchangeRate,
  onAddItem,
  onEdit,
  onDelete,
  onEditItem,
  onDeleteItem,
}: SubscriptionExpenseCardProps) {
  const { subscription, items, totalCharges, totalDeductions, netTotal } = group;
  const CategoryIcon = CATEGORY_ICONS[subscription.category] || Server;
  const categoryStyle = CATEGORY_COLORS[subscription.category] || CATEGORY_COLORS.other;

  const formatAmount = (usd: number) => {
    if (currency === 'USD') return `$${usd.toFixed(2)}`;
    return `₨ ${Math.round(usd * exchangeRate).toLocaleString()}`;
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6 shadow-xl transition-all hover:border-white/20">
      {/* Subscription Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-white/10">
        <div className="flex items-start gap-3.5">
          <div className={`p-3 rounded-xl border shrink-0 ${categoryStyle}`}>
            <CategoryIcon className="w-5 h-5" />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-white tracking-tight">
                Subscription: {subscription.name}
              </h3>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
                {subscription.planName}
              </span>
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-md border capitalize ${
                  subscription.status === 'active'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                {subscription.status}
              </span>
            </div>

            <p className="text-xs text-gray-400 mt-1">
              Provider: <span className="text-gray-300 font-medium">{subscription.provider}</span>
              {subscription.description && ` · ${subscription.description}`}
            </p>

            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400 mt-2">
              <span className="flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-gray-500" />
                {subscription.paymentMethod}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-gray-500" />
                Next cycle: <strong className="text-gray-200">{subscription.nextBillingDate}</strong>
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 text-gray-400">
                {subscription.autoRenew ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Auto-renew active
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                    Manual renewal
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Portal link & Quick Add */}
        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          {subscription.portalUrl && (
            <a
              href={subscription.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-xs flex items-center gap-1.5"
              title="Open provider billing portal"
            >
              <ExternalLink className="w-4 h-4" />
              <span className="hidden sm:inline">Billing Portal</span>
            </a>
          )}
          <button
            onClick={() => onAddItem(subscription.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 transition-colors text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Item</span>
          </button>
          <button
            onClick={() => onEdit(subscription)}
            aria-label={`Edit subscription ${subscription.name}`}
            title="Edit subscription"
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(group)}
            aria-label={`Delete subscription ${subscription.name}`}
            title="Delete subscription"
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expense Items List */}
      <div className="py-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-400 px-1 mb-1">
          <span>Upcoming Cycle Breakdown ({items.length} items)</span>
          <span>Expected Deduction or Charge</span>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-500 border border-dashed border-white/10 rounded-xl">
            No scheduled charges or deductions recorded for this cycle.
          </div>
        ) : (
          items.map((item) => (
            <ExpenseItemRow
              key={item.id}
              item={item}
              currency={currency}
              exchangeRate={exchangeRate}
              onEdit={onEditItem}
              onDelete={onDeleteItem}
            />
          ))
        )}
      </div>

      {/* Total Projected Cost Bar */}
      <div className="mt-2 pt-4 border-t border-white/10 bg-white/[0.01] -mx-6 -mb-6 px-6 py-4 rounded-b-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div>
            <span className="text-gray-500 block">Gross Charges</span>
            <span className="text-gray-200 font-mono font-medium">
              +{formatAmount(totalCharges)}
            </span>
          </div>
          <div className="border-l border-white/10 pl-4">
            <span className="text-gray-500 block">Discounts & Credits</span>
            <span className="text-emerald-400 font-mono font-medium">
              -{formatAmount(totalDeductions)}
            </span>
          </div>
        </div>

        <div className="text-left sm:text-right">
          <span className="text-xs text-gray-400 uppercase tracking-wider block">
            Total Projected Cost
          </span>
          <span className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-white">
            {formatAmount(netTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}

