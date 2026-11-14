// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));

const m = await import('@/lib/maintenance');

const rows = (enabled: string, message = '', until = '') => [
  { key: 'maintenance_mode', value: enabled },
  { key: 'maintenance_message', value: message },
  { key: 'maintenance_until', value: until },
];

beforeEach(() => {
  adminDb = createSupabaseMock();
  m.__resetMaintenanceStateForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('stateFromRows', () => {
  it('reads the three settings, treating missing rows and a bad time as unset', () => {
    expect(m.stateFromRows(rows('true', 'Upgrading', '2026-11-10T12:00:00.000Z'))).toEqual({
      enabled: true, message: 'Upgrading', until: '2026-11-10T12:00:00.000Z',
    });
    expect(m.stateFromRows([])).toEqual(m.MAINTENANCE_OFF);
    expect(m.stateFromRows(rows('yes', '', 'soon')).until).toBeNull();
    expect(m.stateFromRows(rows('yes')).enabled).toBe(false);
  });
});

describe('getMaintenanceState', () => {
  it('reads the flag once per 10 s, sharing one query between concurrent requests', async () => {
    vi.useFakeTimers();
    adminDb.setTable('AppSettings', { data: rows('true', 'Back soon') });
    const [a, b] = await Promise.all([m.getMaintenanceState(), m.getMaintenanceState()]);
    expect(a).toEqual({ enabled: true, message: 'Back soon', until: null });
    expect(b).toBe(a);
    expect(adminDb.callsTo('AppSettings')).toHaveLength(1);
    expect(adminDb.callsTo('AppSettings')[0].ops.find((o) => o.op === 'in')?.args).toEqual([
      'key', ['maintenance_mode', 'maintenance_message', 'maintenance_until'],
    ]);

    adminDb.setTable('AppSettings', { data: null });
    vi.advanceTimersByTime(9_999);
    expect((await m.getMaintenanceState()).enabled).toBe(true);
    vi.advanceTimersByTime(1);
    expect(await m.getMaintenanceState()).toEqual(m.MAINTENANCE_OFF);
  });

  it('applies a switch at once after invalidation', async () => {
    adminDb.setTable('AppSettings', { data: rows('false') });
    expect((await m.getMaintenanceState()).enabled).toBe(false);
    adminDb.setTable('AppSettings', { data: rows('true') });
    m.invalidateMaintenanceCache();
    expect((await m.getMaintenanceState()).enabled).toBe(true);
  });

  it('keeps the last answer when the database fails, and assumes off when it never answered', async () => {
    adminDb.setTable('AppSettings', { error: { message: 'db down' } });
    expect(await m.getMaintenanceState()).toEqual(m.MAINTENANCE_OFF);
    expect(console.error).toHaveBeenCalledWith('[maintenance] Could not read the maintenance flag:', { message: 'db down' });

    vi.useFakeTimers();
    adminDb.setTable('AppSettings', { data: rows('true') });
    expect((await m.getMaintenanceState()).enabled).toBe(true);
    vi.advanceTimersByTime(10_000);
    adminDb.setTable('AppSettings', { error: { message: 'db down' } });
    expect((await m.getMaintenanceState()).enabled).toBe(true);
  });

  it('is forced on by MAINTENANCE_MODE=true without asking the database', async () => {
    vi.stubEnv('MAINTENANCE_MODE', 'true');
    vi.stubEnv('MAINTENANCE_MESSAGE', 'DB upgrade');
    expect(await m.getMaintenanceState()).toEqual({ enabled: true, message: 'DB upgrade', until: null });
    vi.stubEnv('MAINTENANCE_MESSAGE', undefined);
    expect((await m.getMaintenanceState()).message).toBe('');
    expect(adminDb.callsTo('AppSettings')).toHaveLength(0);
  });
});

describe('retryAfterSeconds', () => {
  it('counts down to the end time, else asks for 5 minutes', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    expect(m.retryAfterSeconds('2026-11-10T11:00:00Z', now)).toBe(3600);
    expect(m.retryAfterSeconds('2026-11-10T09:00:00Z', now)).toBe(300);
    expect(m.retryAfterSeconds(null, now)).toBe(300);
    expect(m.retryAfterSeconds(null)).toBe(300);
  });
});

describe('isOpenDuringMaintenance', () => {
  it('keeps the admin area, jobs, webhooks and health open, and nothing a player uses', () => {
    for (const p of ['/admin', '/admin/login', '/api/admin/maintenance', '/api/cron/scheduler', '/api/webhooks/brevo', '/api/auth/send-email-hook', '/api/health', '/api/csrf-token']) {
      expect(m.isOpenDuringMaintenance(p)).toBe(true);
    }
    for (const p of ['/', '/quizzes', '/auth', '/administrator', '/api/live/quizzes/1', '/api/quizzes', '/api/healthy']) {
      expect(m.isOpenDuringMaintenance(p)).toBe(false);
    }
  });
});

describe('maintenancePageHtml', () => {
  it('shows the default text, refreshes itself and is never indexed', () => {
    const html = m.maintenancePageHtml(m.MAINTENANCE_OFF);
    expect(html).toContain('We&#39;re making some improvements to 1Think 2Win.');
    expect(html).toContain('<meta http-equiv="refresh" content="60">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('Expected back by');
  });

  it("escapes the admin's message and shows the end time", () => {
    const html = m.maintenancePageHtml({ enabled: true, message: '  <b>Back</b> & "soon"  ', until: '2026-11-10T12:00:00.000Z' });
    expect(html).toContain('&lt;b&gt;Back&lt;/b&gt; &amp; &quot;soon&quot;');
    expect(html).not.toContain('<b>Back</b>');
    expect(html).toContain('Expected back by <time datetime="2026-11-10T12:00:00.000Z">');
    expect(m.maintenancePageHtml({ enabled: true, message: "it's", until: null })).toContain('it&#39;s');
  });
});
