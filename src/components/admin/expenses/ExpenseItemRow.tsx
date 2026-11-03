'use client';

import React from 'react';
import { ArrowDownRight, ArrowUpRight, Calendar, Pencil, Tag, Trash2 } from 'lucide-react';
import type { ExpenseItem } from '@/types/expense';

interface ExpenseItemRowProps {
  item: ExpenseItem;
  currency: 'USD' | 'PKR';
  exchangeRate: number;
  onEdit: (item: ExpenseItem) => void;
  onDelete: (item: ExpenseItem) => void;
}

export default function ExpenseItemRow({ item, currency, exchangeRate, onEdit, onDelete }: ExpenseItemRowProps) {
  const isDeduction = item.type === 'deduction';

  const displayAmount =
    currency === 'USD'
      ? `$${item.amount.toFixed(2)}`
      : `₨ ${Math.round(item.amount * exchangeRate).toLocaleString()}`;

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border transition-all ${
        isDeduction
          ? 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10'
          : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start sm:items-center gap-3">
        <div
          className={`p-2 rounded-lg shrink-0 mt-0.5 sm:mt-0 ${
            isDeduction
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
          }`}
        >
          {isDeduction ? (
            <ArrowDownRight className="w-4 h-4" />
          ) : (
            <ArrowUpRight className="w-4 h-4" />
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-white text-sm">{item.title}</span>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                isDeduction
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-gray-800 text-gray-300 border-gray-700'
              }`}
            >
              {isDeduction ? 'Deduction / Discount' : 'Charge'}
            </span>
            <span className="text-[11px] text-gray-400 flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded-md">
              <Tag className="w-3 h-3 text-gray-500" />
              {item.category}
            </span>
          </div>

          {item.notes && (
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">{item.notes}</p>
          )}

          <div className="flex items-center gap-1 text-[11px] text-gray-500 mt-1">
            <Calendar className="w-3 h-3" />
            <span>Due {item.dueDate}</span>
          </div>
        </div>
      </div>

      <div className="mt-2 sm:mt-0 flex items-center gap-3 shrink-0">
        <div className="text-left sm:text-right">
          <span
            className={`text-sm sm:text-base font-semibold font-mono tracking-tight ${
              isDeduction ? 'text-emerald-400' : 'text-white'
            }`}
          >
            {isDeduction ? `-${displayAmount}` : displayAmount}
          </span>
          <span className="block text-[10px] text-gray-500 uppercase tracking-wider">
            {item.currency}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(item)}
            aria-label={`Edit ${item.title}`}
            title="Edit"
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            aria-label={`Delete ${item.title}`}
            title="Delete"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

