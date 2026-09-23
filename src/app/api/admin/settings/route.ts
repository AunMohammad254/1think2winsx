import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { getAdminDb } from '@/lib/supabase/db';
import { invalidateWalletEnabledCache } from '@/lib/wallet/service';
import { z } from 'zod';

/**
 * GET /api/admin/settings
 * Returns all AppSettings rows (admin only).
 */
export async function GET(request: NextRequest) {
    const adminSession = await validateAdminSession();
    if (!adminSession.valid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const adminDb = getAdminDb();
        const { data, error } = await adminDb
            .from('AppSettings')
            .select('key, value, description, updatedAt, updatedBy')
            .order('key');

        if (error) throw error;
        return NextResponse.json({ settings: data || [] });
    } catch (err) {
        console.error('[admin/settings] GET error:', err);
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
}

const UpdateSettingSchema = z.object({
    key: z.string().min(1).max(100),
    value: z.string().min(0).max(1000),
});

/**
 * PUT /api/admin/settings
 * Update a single AppSettings row (admin only).
 * Body: { key: string, value: string }
 */
export async function PUT(request: NextRequest) {
    const adminSession = await validateAdminSession();
    if (!adminSession.valid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const parsed = UpdateSettingSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid input', details: parsed.error.issues },
                { status: 400 }
            );
        }

        const { key, value } = parsed.data;
        const adminDb = getAdminDb();
        const now = new Date().toISOString();

        const { data, error } = await adminDb
            .from('AppSettings')
            .upsert({ key, value, updatedAt: now, updatedBy: adminSession.email ?? 'admin' })
            .select()
            .single();

        if (error) throw error;

        // Invalidate in-memory wallet flag cache immediately when toggled
        if (key === 'wallet_enabled') {
            invalidateWalletEnabledCache();
        }

        return NextResponse.json({
            setting: data,
            message: `Setting '${key}' updated successfully.`,
        });
    } catch (err) {
        console.error('[admin/settings] PUT error:', err);
        return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 });
    }
}
