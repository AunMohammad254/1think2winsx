'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, ChevronLeft, CreditCard, Mail, RefreshCw, Search, Send } from 'lucide-react';
import { getCSRFHeaders } from '@/lib/csrf';
import { formatCount } from '@/lib/numbers';
import { formatBusinessStart } from '@/lib/schedule-time';
import type { EmailLogRow, EmailServicesOverview } from '@/lib/mail/admin';
import { PROVIDER_NAMES, type EmailProviderId } from '@/lib/mail/types';

const KINDS: Record<string, string> = {
  registration: 'Registration',
  newsletter_signup: 'Newsletter sign-up',
  newsletter: 'Newsletter',
  password: 'Password',
  account: 'Account',
  support: 'Support',
};

const STATUS_STYLES: Record<string, string> = {
  accepted: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  delivered: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  failed: 'bg-red-500/10 text-red-300 border-red-500/20',
  bounced: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  complained: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
};

const card = 'bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6';
const input = 'px-3 py-2 bg-gray-950/50 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500/50';

const money = (amount: number, unit: string) => (unit === 'USD' ? `$${amount.toFixed(2)}` : `${amount.toFixed(2)} ${unit}`);

async function api(path: string, init: RequestInit = {}) {
  const csrfHeaders = await getCSRFHeaders();
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...csrfHeaders, ...init.headers } });
  return { ok: response.ok, data: await response.json() };
}

/** Accepted / failed / bounced (bounces and complaints together) for one service and period. */
function countsFor(overview: EmailServicesOverview, provider: EmailProviderId, period: '24h' | '30d') {
  const rows = overview.totals.filter((t) => t.provider === provider && t.period === period);
  const sum = (statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).reduce((n, r) => n + r.count, 0);
  return { sent: sum(['accepted', 'delivered', 'bounced', 'complained']), failed: sum(['failed']), bounced: sum(['bounced', 'complained']) };
}

export default function AdminEmailServicesPage() {
  const [overview, setOverview] = useState<EmailServicesOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sesLimit, setSesLimit] = useState('');
  const [refreshingBilling, setRefreshingBilling] = useState(false);

  const [log, setLog] = useState<{ entries: EmailLogRow[]; total: number; pageSize: number }>({ entries: [], total: 0, pageSize: 50 });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: '', provider: '', status: '', kind: '' });
  const [search, setSearch] = useState('');

  const loadOverview = useCallback(async () => {
    try {
      const { ok, data } = await api('/api/admin/email-services');
      if (!ok || !data.success) throw new Error(data.message || 'Could not load the email services.');
      setOverview(data.overview);
      setSesLimit(String(data.overview.limits.ses));
      setLoadError(null);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  const loadLog = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), ...filters });
    try {
      const { ok, data } = await api(`/api/admin/email-log?${params}`);
      if (!ok || !data.success) throw new Error(data.message || 'Could not load the email log.');
      setLog({ entries: data.entries, total: data.total, pageSize: data.pageSize });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }, [page, filters]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadLog(); }, [loadLog]);

  const save = async (change: { provider?: EmailProviderId; sesDailyLimit?: number }, done: string) => {
    setSaving(true);
    try {
      const { ok, data } = await api('/api/admin/email-services', { method: 'PUT', body: JSON.stringify(change) });
      if (!ok || !data.success) throw new Error(data.message || 'Could not save the change.');
      toast.success(done);
      await loadOverview();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const switchTo = (provider: EmailProviderId) => {
    const limit = provider === 'ses' ? overview!.limits.ses : overview!.limits.brevo;
    if (!confirm(`Send all email through ${PROVIDER_NAMES[provider]} from now on? Its daily limit is ${formatCount(limit)} emails.`)) return;
    save({ provider }, `Emails now go through ${PROVIDER_NAMES[provider]} (within a minute on every server).`);
  };

  const saveSesLimit = () => {
    const value = Number(sesLimit);
    if (!Number.isInteger(value) || value < 1) {
      toast.error('Enter a whole number of emails.');
      return;
    }
    save({ sesDailyLimit: value }, 'The SES daily limit is saved.');
  };

  const refreshBilling = async () => {
    setRefreshingBilling(true);
    try {
      const { ok, data } = await api('/api/admin/email-services/refresh-billing', { method: 'POST' });
      if (!ok || !data.success) throw new Error(data.message || 'Could not refresh the AWS billing.');
      setOverview((current) => current && { ...current, awsCost: data.awsCost });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRefreshingBilling(false);
    }
  };

  const applySearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setFilters((f) => ({ ...f, q: search.trim() }));
  };
  const setFilter = (name: 'provider' | 'status' | 'kind', value: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [name]: value }));
  };

  if (!overview) {
    return (
      <div className="min-h-screen bg-gray-950 py-8 px-4 text-gray-300">
        <div className="max-w-7xl mx-auto">
          {loadError ? (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl flex items-center justify-between gap-3">
              <span>{loadError}</span>
              <button onClick={loadOverview} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20">Try again</button>
            </div>
          ) : (
            <p className="text-gray-500">Loading email services…</p>
          )}
        </div>
      </div>
    );
  }

  const other: EmailProviderId = overview.active === 'ses' ? 'brevo' : 'ses';
  const canUseOther = other === 'brevo' || overview.sesConfigured;
  const ses = overview.ses?.ok ? overview.ses.data : null;
  const cost = overview.awsCost.cost;
  const lastPage = Math.max(1, Math.ceil(log.total / log.pageSize));

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-8 px-4">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link href="/admin/dashboard" className="text-gray-400 hover:text-white transition-colors" aria-label="Back to the dashboard">
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-3xl font-bold text-white">Email Services</h1>
            </div>
            <p className="text-gray-400">Which service sends the site&apos;s email, what was sent, and what it costs</p>
          </div>
          <button
            onClick={() => { loadOverview(); loadLog(); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {overview.recentFailures.count > 0 && (
          <div role="alert" className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex flex-col md:flex-row md:items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-red-200">
                {formatCount(overview.recentFailures.count)} email{overview.recentFailures.count === 1 ? '' : 's'} failed through {PROVIDER_NAMES[overview.active]} in the last hour.
              </p>
              {overview.recentFailures.lastError && <p className="text-red-300/80 mt-1">Last error: {overview.recentFailures.lastError}</p>}
            </div>
            {canUseOther && (
              <button disabled={saving} onClick={() => switchTo(other)} className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-100 font-medium hover:bg-red-500/30 disabled:opacity-50">
                Switch to {PROVIDER_NAMES[other]}
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className={`${card} lg:col-span-2`} aria-label="Email service">
            <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2"><Send className="w-5 h-5 text-blue-400" /> Sending service</h2>
            <p className="text-xs text-gray-500 mb-4">Only an admin changes this. If the service has problems, switch here; nothing switches by itself.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['ses', 'brevo'] as const).map((provider) => {
                const selected = overview.selected === provider;
                const unavailable = provider === 'ses' && !overview.sesConfigured;
                return (
                  <button
                    key={provider}
                    disabled={saving || selected || unavailable}
                    onClick={() => switchTo(provider)}
                    aria-pressed={selected}
                    className={`text-left p-4 rounded-xl border transition-colors disabled:cursor-not-allowed ${selected ? 'border-blue-500/60 bg-blue-500/10' : 'border-white/10 bg-gray-950/40 hover:bg-white/5'} ${unavailable ? 'opacity-50' : ''}`}
                  >
                    <p className="font-semibold text-white">{PROVIDER_NAMES[provider]}{selected ? ' (selected)' : ''}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Daily limit {formatCount(provider === 'ses' ? overview.limits.ses : overview.limits.brevo)} emails
                      {provider === 'brevo' ? ' · backup' : ` · ${overview.sesRegion}`}
                    </p>
                    {unavailable && <p className="text-xs text-amber-300 mt-1">Not set up: add the AWS access key in hPanel</p>}
                  </button>
                );
              })}
            </div>

            {overview.selected !== overview.active && (
              <p className="mt-3 text-sm text-amber-300">Amazon SES is selected but has no access key on the server, so emails go through Brevo.</p>
            )}
            {ses && !ses.productionAccess && (
              <p className="mt-3 text-sm text-amber-300">AWS SES is still in its sandbox: it only sends to verified addresses, at most {formatCount(ses.max24HourSend)} a day.</p>
            )}
            {ses && (!ses.sendingEnabled || (ses.enforcementStatus && ses.enforcementStatus !== 'HEALTHY')) && (
              <p className="mt-3 text-sm text-red-300">AWS reports a problem with this account: sending {ses.sendingEnabled ? 'is on' : 'is paused'}, status {ses.enforcementStatus ?? 'unknown'}.</p>
            )}
            {overview.ses && !overview.ses.ok && <p className="mt-3 text-sm text-red-300">AWS SES status: {overview.ses.error}</p>}

            {overview.sesConfigured && (
              <div className="mt-5 flex flex-wrap items-end gap-2">
                <label className="text-sm text-gray-300">
                  <span className="block mb-1">SES daily limit (keep it a little under the AWS quota)</span>
                  <input aria-label="SES daily limit" type="number" min={1} value={sesLimit} onChange={(e) => setSesLimit(e.target.value)} className={`${input} w-40`} />
                </label>
                <button disabled={saving} onClick={saveSesLimit} className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-200 hover:bg-white/10 disabled:opacity-50">Save limit</button>
              </div>
            )}
          </section>

          <section className={card} aria-label="Emails sent">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><Mail className="w-5 h-5 text-purple-400" /> Emails sent</h2>
            {overview.quota && (
              <p className="text-sm text-gray-300 mb-3">
                Last 24 hours: <strong className="text-white">{formatCount(overview.quota.used)} / {formatCount(overview.quota.limit)}</strong>
                {overview.quota.nextFreeAt ? ` · next frees up ${formatBusinessStart(overview.quota.nextFreeAt)}` : ''}
              </p>
            )}
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs"><tr><th className="text-left font-medium pb-1">Service</th><th className="text-right font-medium">24 h</th><th className="text-right font-medium">30 days</th></tr></thead>
              <tbody className="text-gray-300">
                {(['ses', 'brevo'] as const).map((provider) => {
                  const day = countsFor(overview, provider, '24h');
                  const month = countsFor(overview, provider, '30d');
                  return (
                    <tr key={provider} className="border-t border-white/5">
                      <td className="py-2">{PROVIDER_NAMES[provider]}</td>
                      <td className="text-right">{formatCount(day.sent)} sent{day.failed ? `, ${formatCount(day.failed)} failed` : ''}</td>
                      <td className="text-right">{formatCount(month.sent)} sent{month.bounced ? `, ${formatCount(month.bounced)} bounced` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {ses && (
              <p className="text-xs text-gray-500 mt-3">AWS quota: {formatCount(ses.sentLast24Hours)} of {formatCount(ses.max24HourSend)} used in 24 hours, up to {formatCount(ses.maxSendRate)} a second.</p>
            )}
          </section>
        </div>

        <section className={card} aria-label="Billing">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><CreditCard className="w-5 h-5 text-emerald-400" /> Billing</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white">AWS</h3>
                {overview.awsCost.configured && (
                  <button
                    onClick={refreshBilling}
                    disabled={refreshingBilling || !!overview.awsCost.refreshAvailableAt}
                    title={overview.awsCost.refreshAvailableAt ? `Available again ${formatBusinessStart(overview.awsCost.refreshAvailableAt)}` : 'Each refresh costs $0.02'}
                    className="text-xs px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 disabled:opacity-50"
                  >
                    {refreshingBilling ? 'Refreshing…' : 'Refresh'}
                  </button>
                )}
              </div>
              {!overview.awsCost.configured && <p className="text-sm text-gray-500">Add the AWS access key in hPanel to see AWS billing.</p>}
              {overview.awsCost.error && <p className="text-sm text-red-300">{overview.awsCost.error}</p>}
              {cost && (
                <div className="text-sm text-gray-300 space-y-1">
                  <p>This month so far: <strong className="text-white">{money(cost.monthToDate.amount, cost.monthToDate.unit)}</strong>{cost.monthToDate.estimated ? ' (estimated)' : ''}</p>
                  <p>
                    Expected for the whole month:{' '}
                    {cost.forecastRest
                      ? <strong className="text-white">{money(cost.monthToDate.amount + cost.forecastRest.amount, cost.forecastRest.unit)}</strong>
                      : <span className="text-gray-500">no forecast yet (AWS needs more history)</span>}
                  </p>
                  <p className="text-xs text-gray-500">As of {formatBusinessStart(cost.fetchedAt)}. AWS updates costs about once a day.</p>
                </div>
              )}
            </div>
            <div>
              <h3 className="font-semibold text-white mb-2">Brevo</h3>
              {!overview.brevo && <p className="text-sm text-gray-500">No Brevo API key on the server.</p>}
              {overview.brevo && !overview.brevo.ok && <p className="text-sm text-red-300">{overview.brevo.error}</p>}
              {overview.brevo?.ok && (
                <ul className="text-sm text-gray-300 space-y-1">
                  {overview.brevo.data.length === 0 && <li className="text-gray-500">Brevo reported no plan.</li>}
                  {overview.brevo.data.map((plan, i) => (
                    <li key={i}>
                      <strong className="text-white capitalize">{plan.type}</strong>
                      {plan.credits !== null ? ` · ${formatCount(plan.credits)} ${plan.creditsType === 'sendLimit' ? 'emails left' : 'credits left'}` : ''}
                      {plan.endDate ? ` · renews ${plan.endDate}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className={card} aria-label="Email log">
          <h2 className="text-xl font-bold text-white mb-4">Email log</h2>
          <div className="flex flex-col md:flex-row gap-2 mb-4">
            <form onSubmit={applySearch} className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input aria-label="Search the email log" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recipient or subject…" className={`${input} w-full pl-9`} />
            </form>
            <select aria-label="Service" value={filters.provider} onChange={(e) => setFilter('provider', e.target.value)} className={input}>
              <option value="">All services</option>
              <option value="ses">Amazon SES</option>
              <option value="brevo">Brevo</option>
            </select>
            <select aria-label="Result" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={input}>
              <option value="">All results</option>
              {Object.keys(STATUS_STYLES).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Type" value={filters.kind} onChange={(e) => setFilter('kind', e.target.value)} className={input}>
              <option value="">All types</option>
              {Object.entries(KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>

          <div className="overflow-x-auto border border-white/10 rounded-xl">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-white/5 text-gray-400 text-xs">
                <tr>
                  <th className="text-left font-medium p-3">Time (PKT)</th>
                  <th className="text-left font-medium p-3">Type</th>
                  <th className="text-left font-medium p-3">Recipient</th>
                  <th className="text-left font-medium p-3">Subject</th>
                  <th className="text-left font-medium p-3">Service</th>
                  <th className="text-left font-medium p-3">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-gray-300">
                {log.entries.length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-gray-500">No emails match.</td></tr>
                )}
                {log.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="p-3 whitespace-nowrap">{formatBusinessStart(entry.sentAt)}</td>
                    <td className="p-3">{KINDS[entry.kind] ?? entry.kind}</td>
                    <td className="p-3 break-all">{entry.recipient}</td>
                    <td className="p-3">{entry.subject}</td>
                    <td className="p-3">{PROVIDER_NAMES[entry.provider]}</td>
                    <td className="p-3">
                      <span title={entry.error ?? undefined} className={`inline-block px-2 py-0.5 rounded-md border text-xs ${STATUS_STYLES[entry.status] ?? ''}`}>{entry.status}</span>
                      {entry.error && <p className="text-xs text-gray-500 mt-1 max-w-xs truncate" title={entry.error}>{entry.error}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-sm text-gray-400">
            <span>{formatCount(log.total)} email{log.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 disabled:opacity-40">Previous</button>
              <span>Page {page} of {lastPage}</span>
              <button disabled={page >= lastPage} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 disabled:opacity-40">Next</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
