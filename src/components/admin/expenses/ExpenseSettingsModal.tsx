'use client';

import React, { useState } from 'react';
import { X, Settings2, Check, Loader2, Info } from 'lucide-react';
import type { ExpenseConfigSettings } from '@/types/expense';

interface ExpenseSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ExpenseConfigSettings;
  onSettingsSaved: (updated: ExpenseConfigSettings) => void;
  getCSRFHeaders: () => Promise<Record<string, string>>;
}

export default function ExpenseSettingsModal({
  isOpen,
  onClose,
  settings,
  onSettingsSaved,
  getCSRFHeaders,
}: ExpenseSettingsModalProps) {
  const [defaultCurrency, setDefaultCurrency] = useState<'USD' | 'PKR'>(settings.defaultCurrency);
  const [alertThresholdUSD, setAlertThresholdUSD] = useState(settings.alertThresholdUSD.toString());
  const [exchangeRateUsdToPkr, setExchangeRateUsdToPkr] = useState(
    settings.exchangeRateUsdToPkr.toString()
  );
  const [enableRenewalReminders, setEnableRenewalReminders] = useState(
    settings.enableRenewalReminders
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const csrfHeaders = await getCSRFHeaders();
      const res = await fetch('/api/admin/expenses', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders,
        },
        body: JSON.stringify({
          entity: 'settings',
          data: {
            defaultCurrency,
            alertThresholdUSD: parseFloat(alertThresholdUSD) || 300,
            exchangeRateUsdToPkr: parseFloat(exchangeRateUsdToPkr) || 278.5,
            enableRenewalReminders,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save configuration settings');
      }

      onSettingsSaved(data.settings);
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 1000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-gray-950/60 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500/50 transition-colors';
  const labelClass = 'block text-xs font-medium text-gray-300 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-gray-900 border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Expense Manager Settings</h2>
              <p className="text-xs text-gray-400">Financial thresholds & billing configurations</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Default Display Currency</label>
              <select
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value as 'USD' | 'PKR')}
                className={inputClass}
              >
                <option value="USD">USD ($) - United States Dollar</option>
                <option value="PKR">PKR (₨) - Pakistani Rupee</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>USD to PKR Exchange Rate</label>
              <input
                type="number"
                step="0.01"
                min="1"
                value={exchangeRateUsdToPkr}
                onChange={(e) => setExchangeRateUsdToPkr(e.target.value)}
                className={inputClass}
                required
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Monthly Budget Alert Threshold (USD)</label>
            <input
              type="number"
              step="1"
              min="10"
              value={alertThresholdUSD}
              onChange={(e) => setAlertThresholdUSD(e.target.value)}
              className={inputClass}
              required
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Warn administrators when upcoming billing cycle total exceeds this amount.
            </p>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/[0.02] border border-white/5">
            <div>
              <span className="text-sm font-medium text-white block">Auto-Renewal Reminders</span>
              <span className="text-xs text-gray-400">
                Send admin email alerts 3 days prior to renewal dates
              </span>
            </div>
            <input
              type="checkbox"
              checked={enableRenewalReminders}
              onChange={(e) => setEnableRenewalReminders(e.target.checked)}
              className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 focus:ring-offset-gray-900"
            />
          </div>

          {/* Billing API Integration Note */}
          <div className="p-3.5 rounded-xl bg-purple-500/5 border border-purple-500/20 text-xs text-gray-300 space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-purple-300">
              <Info className="w-4 h-4 shrink-0" />
              <span>Billing Service Integration</span>
            </div>
            <p className="text-gray-400 text-[11px] leading-relaxed">
              AWS Cost Explorer is synchronized hourly with cached results to minimize cost.
              Supabase, Hostinger, and Cloudinary deductions are managed through contract discount
              vouchers and AppSettings.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : savedSuccess ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Saved!</span>
                </>
              ) : (
                <span>Save Settings</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

