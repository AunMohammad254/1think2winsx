import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateAdminSession } from '@/lib/admin-session';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { getAdminDb } from '@/lib/supabase/db';
import { purgeCloudflareCache } from '@/lib/cloudflare-purge';
import {
    MAINTENANCE_KEYS,
    invalidateMaintenanceCache,
    stateFromRows,
} from '@/lib/maintenance';

type Row = { key: string; value: string; updatedAt?: string; updatedBy?: string | null };

async function readRows(): Promise<Row[]> {
    const { data, error } = await getAdminDb()
        .from('AppSettings')
        .select('key, value, updatedAt, updatedBy')
        .in('key', Object.values(MAINTENANCE_KEYS));
    if (error) throw error;
    return (data ?? []) as Row[];
}

/** The state plus who last switched it, for the admin card */
function toPayload(rows: Row[]) {
    const switchRow = rows.find((r) => r.key === MAINTENANCE_KEYS.enabled);
    return {
        ...stateFromRows(rows),
        updatedAt: switchRow?.updatedAt ?? null,
        updatedBy: switchRow?.updatedBy ?? null,
        // An env override wins over the switch: the admin card says so
        forcedByEnv: process.env.MAINTENANCE_MODE === 'true',
        autoPurge: Boolean(process.env.CLOUDFLARE_ZONE_ID?.trim() && process.env.CLOUDFLARE_API_TOKEN?.trim()),
    };
}

/** GET /api/admin/maintenance: whether maintenance mode is on, its message and end time (admin only). */
export async function GET() {
    const session = await validateAdminSession();
    if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        return NextResponse.json({ maintenance: toPayload(await readRows()) });
    } catch (err) {
        console.error('[admin/maintenance] GET error:', err);
        return NextResponse.json({ error: 'Failed to read maintenance mode' }, { status: 500 });
    }
}

const UpdateSchema = z.object({
    enabled: z.boolean(),
    message: z.string().max(500).default(''),
    until: z.iso.datetime({ offset: true }).nullable().default(null),
});

/**
 * PUT /api/admin/maintenance  { enabled, message?, until? }  (admin only)
 * Saves the switch, applies it on this server at once, and purges Cloudflare when the switch flipped
 * so the cached public pages follow it too.
 */
export async function PUT(request: NextRequest) {
    const session = await validateAdminSession();
    if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const csrf = await requireCSRFToken(request);
    if (csrf) return csrf;

    const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }
    const { enabled, message, until } = parsed.data;

    try {
        const before = stateFromRows(await readRows());
        const updatedAt = new Date().toISOString();
        const updatedBy = session.email ?? 'admin';
        const { error } = await getAdminDb()
            .from('AppSettings')
            .upsert([
                { key: MAINTENANCE_KEYS.enabled, value: String(enabled), description: 'Maintenance mode: players see a "back soon" page', updatedAt, updatedBy },
                { key: MAINTENANCE_KEYS.message, value: message.trim(), description: 'Maintenance page message (empty = default text)', updatedAt, updatedBy },
                { key: MAINTENANCE_KEYS.until, value: until ?? '', description: 'When the site should be back (ISO time, optional)', updatedAt, updatedBy },
            ]);
        if (error) throw error;
        invalidateMaintenanceCache();
        console.info(`[admin/maintenance] ${updatedBy} turned maintenance mode ${enabled ? 'ON' : 'OFF'}`);

        // Only a flip changes what the cached pages should be; editing the message does not
        const purge = before.enabled === enabled ? 'unchanged' : await purgeCloudflareCache();

        return NextResponse.json({ maintenance: toPayload(await readRows()), purge });
    } catch (err) {
        console.error('[admin/maintenance] PUT error:', err);
        return NextResponse.json({ error: 'Failed to update maintenance mode' }, { status: 500 });
    }
}
