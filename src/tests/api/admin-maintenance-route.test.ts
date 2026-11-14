// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const h = vi.hoisted(() => ({
  validateAdminSession: vi.fn(),
  requireCSRFToken: vi.fn(),
  purge: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: () => h.validateAdminSession() }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (r: unknown) => h.requireCSRFToken(r) }));
vi.mock('@/lib/cloudflare-purge', () => ({ purgeCloudflareCache: () => h.purge() }));
vi.mock('@/lib/maintenance', async (orig) => ({
  ...(await orig<typeof import('@/lib/maintenance')>()),
  invalidateMaintenanceCache: () => h.invalidate(),
}));

const route = await import('@/app/api/admin/maintenance/route');

const row = (key: string, value: string) => ({ key, value, updatedAt: '2026-11-10T08:00:00Z', updatedBy: 'admin@example.test' });
const onRows = [row('maintenance_mode', 'true'), row('maintenance_message', 'Upgrading'), row('maintenance_until', '')];
const put = (body: unknown) => route.PUT(makeRequest('/api/admin/maintenance', { method: 'PUT', body }));

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of Object.values(h)) fn.mockReset();
  h.validateAdminSession.mockResolvedValue({ valid: true, email: 'admin@example.test' });
  h.requireCSRFToken.mockResolvedValue(null);
  h.purge.mockResolvedValue('purged');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/admin/maintenance', () => {
  it('needs an admin', async () => {
    h.validateAdminSession.mockResolvedValue({ valid: false });
    expect((await route.GET()).status).toBe(401);
  });

  it('returns the state, who switched it, and whether the env forces it or purges are automatic', async () => {
    adminDb.setTable('AppSettings', { data: onRows });
    vi.stubEnv('MAINTENANCE_MODE', 'true');
    vi.stubEnv('CLOUDFLARE_ZONE_ID', 'z');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 't');
    const body = await (await route.GET()).json();
    expect(body.maintenance).toEqual({
      enabled: true, message: 'Upgrading', until: null,
      updatedAt: '2026-11-10T08:00:00Z', updatedBy: 'admin@example.test', forcedByEnv: true, autoPurge: true,
    });
  });

  it('describes a site that was never switched', async () => {
    adminDb.setTable('AppSettings', { data: null });
    const body = await (await route.GET()).json();
    expect(body.maintenance).toMatchObject({ enabled: false, updatedAt: null, updatedBy: null, forcedByEnv: false, autoPurge: false });
  });

  it('answers 500 when the settings cannot be read', async () => {
    adminDb.setTable('AppSettings', { error: { message: 'db down' } });
    const res = await route.GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to read maintenance mode' });
  });
});

describe('PUT /api/admin/maintenance', () => {
  it('needs an admin and a CSRF token', async () => {
    h.validateAdminSession.mockResolvedValue({ valid: false });
    expect((await put({ enabled: true })).status).toBe(401);
    h.validateAdminSession.mockResolvedValue({ valid: true });
    h.requireCSRFToken.mockResolvedValue(NextResponse.json({ error: 'csrf' }, { status: 403 }));
    expect((await put({ enabled: true })).status).toBe(403);
  });

  it('rejects a bad body', async () => {
    for (const body of [{ enabled: 'yes' }, { enabled: true, until: 'tomorrow' }, { enabled: true, message: 'x'.repeat(501) }]) {
      expect((await put(body)).status).toBe(400);
    }
    const res = await route.PUT(makeRequest('/api/admin/maintenance', { method: 'PUT', rawBody: '{oops', headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(400);
  });

  it('turns maintenance on: saves all three settings, applies them at once and purges Cloudflare', async () => {
    adminDb.setTable('AppSettings', [{ data: [] }, { data: null }, { data: onRows }]);
    const res = await put({ enabled: true, message: '  Upgrading  ', until: '2026-11-10T12:00:00+05:00' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ purge: 'purged', maintenance: { enabled: true, message: 'Upgrading' } });

    const upsert = adminDb.callsTo('AppSettings')[1].ops.find((o) => o.op === 'upsert')!.args[0] as Record<string, string>[];
    expect(upsert.map((r) => [r.key, r.value, r.updatedBy])).toEqual([
      ['maintenance_mode', 'true', 'admin@example.test'],
      ['maintenance_message', 'Upgrading', 'admin@example.test'],
      ['maintenance_until', '2026-11-10T12:00:00+05:00', 'admin@example.test'],
    ]);
    expect(upsert.every((r) => r.updatedAt && r.description)).toBe(true);
    expect(h.invalidate).toHaveBeenCalled();
    expect(h.purge).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith('[admin/maintenance] admin@example.test turned maintenance mode ON');
  });

  it('only saves the message (no purge) when the switch did not flip', async () => {
    h.validateAdminSession.mockResolvedValue({ valid: true });
    adminDb.setTable('AppSettings', [{ data: onRows }, { data: null }, { data: onRows }]);
    const body = await (await put({ enabled: true })).json();
    expect(body.purge).toBe('unchanged');
    expect(h.purge).not.toHaveBeenCalled();
    const upsert = adminDb.callsTo('AppSettings')[1].ops.find((o) => o.op === 'upsert')!.args[0] as Record<string, string>[];
    expect(upsert.map((r) => r.value)).toEqual(['true', '', '']);
    expect(upsert[0].updatedBy).toBe('admin');
  });

  it('turns it off and reports a purge that could not run', async () => {
    h.purge.mockResolvedValue('skipped');
    adminDb.setTable('AppSettings', [{ data: onRows }, { data: null }, { data: [] }]);
    const body = await (await put({ enabled: false, until: null })).json();
    expect(body).toMatchObject({ purge: 'skipped', maintenance: { enabled: false } });
    expect(console.info).toHaveBeenCalledWith('[admin/maintenance] admin@example.test turned maintenance mode OFF');
  });

  it('answers 500 when saving fails', async () => {
    adminDb.setTable('AppSettings', [{ data: [] }, { error: { message: 'write failed' } }]);
    const res = await put({ enabled: true });
    expect(res.status).toBe(500);
    expect(h.invalidate).not.toHaveBeenCalled();
  });
});
