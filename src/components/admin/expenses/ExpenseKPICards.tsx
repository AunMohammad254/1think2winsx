'use client';

import React from 'react';
import { DollarSign, TrendingDown, Layers, Clock, ArrowUpRight } from 'lucide-react';
import type { ExpenseSummary } from '@/types/expense';

interface ExpenseKPICardsProps {
  summary: ExpenseSummary;
  currency: 'USD' | 'PKR';
}

export default function ExpenseKPICards({ summary, currency }: ExpenseKPICardsProps) {
  const formatAmount = (usd: number) => {
    if (currency === 'USD') return `$${usd.toFixed(2)}`;
    return `₨ ${Math.round(usd * summary.exchangeRateUsdToPkr).toLocaleString()}`;
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Projected Cost Card */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-5 shadow-lg relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl group-hover:bg-purple-500/20 transition-all pointer-events-none" />
        <div className="flex justify-between items-start">
          <div>
            <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">
              Projected Net Cost
            </p>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white mt-1.5 font-mono">
              {formatAmount(summary.totalProjectedCostUSD)}
            </h3>
            <p className="text-purple-300 text-xs mt-2 flex items-center gap-1 font-medium">
              <span>{summary.billingPeriodLabel}</span>
            </p>
          </div>
          <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Gross Charges Card */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-5 shadow-lg relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all pointer-events-none" />
        <div className="flex justify-between items-start">
          <div>
            <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">
              Upcoming Charges
            </p>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white mt-1.5 font-mono">
              {formatAmount(summary.totalChargesUSD)}
            </h3>
            <p className="text-blue-400 text-xs mt-2 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Gross recurring services</span>
            </p>
          </div>
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Deductions & Credits Card */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-5 shadow-lg relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all pointer-events-none" />
        <div className="flex justify-between items-start">
          <div>
            <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">
              Deductions & Credits
            </p>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-emerald-400 mt-1.5 font-mono">
              -{formatAmount(summary.totalDeductionsUSD)}
            </h3>
            <p className="text-emerald-300 text-xs mt-2 flex items-center gap-1">
              <TrendingDown className="w-3.5 h-3.5" />
              <span>Applied savings & discounts</span>
            </p>
          </div>
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
            <TrendingDown className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Active Subscriptions Card */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-5 shadow-lg relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all pointer-events-none" />
        <div className="flex justify-between items-start">
          <div>
            <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">
              Active Subscriptions
            </p>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white mt-1.5 font-mono">
              {summary.totalActiveSubscriptions}
            </h3>
            <p className="text-amber-400 text-xs mt-2 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>
                Next due:{' '}
                {summary.nextUpcomingBillingDate
                  ? summary.nextUpcomingBillingDate
                  : 'None pending'}
              </span>
            </p>
          </div>
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
        </div>
      </div>
    </div>
  );
}

