'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Wallet, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface AppSetting {
    key: string;
    value: string;
    description?: string | null;
    updatedAt?: string;
    updatedBy?: string | null;
}

/**
 * Admin control for the wallet feature kill switch (AppSettings.wallet_enabled).
 * When off: quizzes are free for everyone (no payment prompt), and the wallet
 * UI (balance, deposit, transaction history) is hidden across the app.
 */
export default function WalletFeatureToggle() {
    const [enabled, setEnabled] = useState<boolean | null>(null);
    const [meta, setMeta] = useState<{ updatedAt?: string; updatedBy?: string | null }>({});
    const [saving, setSaving] = useState(false);
    const [csrfToken, setCsrfToken] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/admin/settings')
            .then((r) => r.json())
            .then((d: { settings?: AppSetting[] }) => {
                const row = d.settings?.find((s) => s.key === 'wallet_enabled');
                setEnabled(row ? row.value !== 'false' : true);
                setMeta({ updatedAt: row?.updatedAt, updatedBy: row?.updatedBy });
            })
            .catch(() => setEnabled(true));

        fetch('/api/csrf-token')
            .then((r) => r.json())
            .then((d: { csrfToken: string }) => setCsrfToken(d.csrfToken))
            .catch(() => {});
    }, []);

    const handleToggle = async (checked: boolean) => {
        const previous = enabled;
        setEnabled(checked); // optimistic
        setSaving(true);
        try {
            const res = await fetch('/api/admin/settings', {
                method: 'PUT',
                headers: {
                    'content-type': 'application/json',
                    ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
                },
                body: JSON.stringify({ key: 'wallet_enabled', value: checked ? 'true' : 'false' }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update setting');

            setMeta({ updatedAt: data.setting?.updatedAt, updatedBy: data.setting?.updatedBy });
            toast.success(
                checked
                    ? 'Wallet enabled — quizzes require the 2 PKR/24h payment again.'
                    : 'Wallet disabled — quizzes are now free for everyone.'
            );
        } catch (err) {
            setEnabled(previous); // revert on failure
            toast.error(err instanceof Error ? err.message : 'Failed to update wallet setting');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6 mb-6">
            <div className="flex items-start justify-between gap-6 flex-wrap">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 mt-0.5">
                        <Wallet className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white">Wallet Feature</h2>
                        <p className="text-gray-400 text-sm max-w-xl mt-1">
                            {enabled === false
                                ? 'Currently OFF — quizzes are free for everyone, no payment prompt. Balance, deposit and transaction history are hidden across the app.'
                                : 'Currently ON — players pay 2 PKR for 24-hour quiz access. Balance, deposit and transaction history are visible.'}
                        </p>
                        {meta.updatedAt && (
                            <p className="text-gray-500 text-xs mt-2">
                                Last changed {new Date(meta.updatedAt).toLocaleString()}
                                {meta.updatedBy ? ` by ${meta.updatedBy}` : ''}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {saving && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
                    <Label htmlFor="wallet-enabled-switch" className="text-sm text-gray-300">
                        {enabled === null ? 'Loading…' : enabled ? 'Enabled' : 'Disabled'}
                    </Label>
                    <Switch
                        id="wallet-enabled-switch"
                        checked={enabled ?? true}
                        disabled={enabled === null || saving}
                        onCheckedChange={handleToggle}
                    />
                </div>
            </div>
        </div>
    );
}
