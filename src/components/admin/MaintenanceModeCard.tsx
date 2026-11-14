'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Wrench } from 'lucide-react';

interface MaintenanceInfo {
    enabled: boolean;
    message: string;
    until: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
    forcedByEnv: boolean;
    autoPurge: boolean;
}

type Purge = 'purged' | 'skipped' | 'failed' | 'unchanged';

/** "2026-11-08T15:30" in this browser's time zone, for a datetime-local input */
export function toLocalInput(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}

const PURGE_NOTICE: Record<Purge, ((on: boolean) => [kind: 'success' | 'warning' | 'error', text: string]) | null> = {
    purged: () => ['success', 'Cloudflare cache purged: every page follows the switch now.'],
    skipped: (on) => ['warning', `Cloudflare still has cached public pages: purge its cache so visitors who aren't signed in ${on ? 'see the maintenance page' : 'get the site back'} too.`],
    failed: () => ['error', "Couldn't purge the Cloudflare cache: purge it from the Cloudflare dashboard."],
    unchanged: null,
};

/**
 * Admin switch for maintenance mode. While it is on, players get a "back soon" page and the player
 * APIs answer 503; admins keep using the whole site (see src/lib/maintenance.ts).
 */
export default function MaintenanceModeCard() {
    const [info, setInfo] = useState<MaintenanceInfo | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [message, setMessage] = useState('');
    const [until, setUntil] = useState('');
    const [saving, setSaving] = useState(false);
    const [csrfToken, setCsrfToken] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/admin/maintenance')
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((d: { maintenance: MaintenanceInfo }) => {
                setInfo(d.maintenance);
                setMessage(d.maintenance.message);
                setUntil(toLocalInput(d.maintenance.until));
            })
            .catch(() => setLoadError(true));

        fetch('/api/csrf-token')
            .then((r) => r.json())
            .then((d: { csrfToken: string }) => setCsrfToken(d.csrfToken))
            .catch(() => {});
    }, []);

    const save = async (enabled: boolean) => {
        if (enabled && !info!.enabled && !window.confirm('Turn on maintenance mode? Players will see the maintenance page until you turn it off.')) {
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/admin/maintenance', {
                method: 'PUT',
                headers: { 'content-type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
                body: JSON.stringify({ enabled, message, until: until ? new Date(until).toISOString() : null }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update maintenance mode');

            setInfo(data.maintenance);
            toast.success(
                enabled === info!.enabled
                    ? 'Maintenance message saved.'
                    : enabled
                        ? 'Maintenance mode is ON: players now see the maintenance page.'
                        : 'Maintenance mode is OFF: the site is open again.'
            );
            const notice = PURGE_NOTICE[data.purge as Purge]?.(enabled);
            if (notice) toast[notice[0]](notice[1], { duration: 10_000 });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update maintenance mode');
        } finally {
            setSaving(false);
        }
    };

    const on = info?.enabled ?? false;

    return (
        <section
            className={`rounded-2xl border p-6 mb-8 bg-gradient-to-br from-gray-900/80 to-gray-800/60 ${
                on ? 'border-red-500/40' : 'border-white/10'
            }`}
        >
            <div className="flex items-start gap-3 mb-4">
                <div className={`p-2 rounded-xl mt-0.5 ${on ? 'bg-red-500/20' : 'bg-amber-500/15'}`}>
                    <Wrench className={`w-5 h-5 ${on ? 'text-red-400' : 'text-amber-400'}`} />
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-lg font-bold text-white">Maintenance mode</h2>
                        {info && (
                            <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                    on ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/15 text-emerald-300'
                                }`}
                            >
                                {on ? 'ON: players see the maintenance page' : 'OFF: site is open'}
                            </span>
                        )}
                    </div>
                    <p className="text-gray-400 text-sm mt-1 max-w-2xl">
                        While on, players get a &quot;back soon&quot; page and can&apos;t play or save anything. You (signed in
                        as admin) keep using the whole site to check your work.
                    </p>
                    {info?.updatedAt && (
                        <p className="text-gray-500 text-xs mt-2">
                            Last changed {new Date(info.updatedAt).toLocaleString()}
                            {info.updatedBy ? ` by ${info.updatedBy}` : ''}
                        </p>
                    )}
                </div>
            </div>

            {loadError && <p className="text-sm text-red-400">Couldn&apos;t load the maintenance setting. Reload the page to try again.</p>}
            {!info && !loadError && <Loader2 className="w-5 h-5 text-gray-400 animate-spin" aria-label="Loading" />}

            {info && (
                <>
                    {info.forcedByEnv && (
                        <p className="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200">
                            MAINTENANCE_MODE=true is set on the server, so the site stays in maintenance whatever this switch says.
                            Remove it in hPanel to hand control back to this switch.
                        </p>
                    )}
                    {!info.autoPurge && (
                        <p className="mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-200">
                            After switching, purge the Cloudflare cache: until then, visitors who aren&apos;t signed in still get
                            cached copies of the public pages. (Set CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN to purge
                            automatically.)
                        </p>
                    )}

                    <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                        <label className="block">
                            <span className="text-sm text-gray-300">Message for players (optional)</span>
                            <textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                maxLength={500}
                                rows={2}
                                placeholder="We're making some improvements to 1Think 2Win. We'll be back shortly."
                                className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/60"
                            />
                        </label>
                        <label className="block">
                            <span className="text-sm text-gray-300">Back by (optional)</span>
                            <input
                                type="datetime-local"
                                value={until}
                                onChange={(e) => setUntil(e.target.value)}
                                className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/60 [color-scheme:dark]"
                            />
                        </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 mt-4">
                        {on ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => save(false)}
                                    disabled={saving}
                                    className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                                >
                                    Turn off maintenance
                                </button>
                                <button
                                    type="button"
                                    onClick={() => save(true)}
                                    disabled={saving}
                                    className="px-4 py-2 rounded-xl text-sm font-medium text-gray-200 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 transition-colors"
                                >
                                    Save message
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={() => save(true)}
                                disabled={saving}
                                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-colors"
                            >
                                Turn on maintenance
                            </button>
                        )}
                        {saving && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" aria-label="Saving" />}
                    </div>
                </>
            )}
        </section>
    );
}
