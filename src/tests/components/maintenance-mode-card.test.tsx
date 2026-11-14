import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import MaintenanceModeCard, { toLocalInput } from '@/components/admin/MaintenanceModeCard';

const off = { enabled: false, message: '', until: null, updatedAt: null, updatedBy: null, forcedByEnv: false, autoPurge: true };
const on = { ...off, enabled: true, message: 'Upgrading', updatedAt: '2026-11-10T08:00:00Z', updatedBy: 'admin@example.test' };

let fetchMock: ReturnType<typeof vi.fn>;
let maintenanceGet: () => Promise<Response>;
type Put = (url: string, init: RequestInit) => Promise<Response>;
let maintenancePut: ReturnType<typeof vi.fn<Put>>;
let csrf: () => Promise<Response>;

beforeEach(() => {
  for (const fn of Object.values(toast)) fn.mockReset();
  maintenanceGet = async () => jsonResponse({ maintenance: off });
  maintenancePut = vi.fn<Put>(async () => jsonResponse({ maintenance: on, purge: 'purged' }));
  csrf = async () => jsonResponse({ csrfToken: 'csrf-1' });
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/csrf-token') return csrf();
    return init?.method === 'PUT' ? maintenancePut(url, init!) : maintenanceGet();
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const putBody = () => JSON.parse(maintenancePut.mock.calls.at(-1)![1].body as string);

describe('MaintenanceModeCard', () => {
  it('shows the site open, then turns maintenance on after a confirmation', async () => {
    render(<MaintenanceModeCard />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(await screen.findByText('OFF: site is open')).toBeInTheDocument();
    expect(screen.queryByText(/purge the Cloudflare cache/)).toBeNull(); // auto-purge is set up

    fireEvent.change(screen.getByLabelText(/Message for players/), { target: { value: 'Upgrading' } });
    fireEvent.change(screen.getByLabelText(/Back by/), { target: { value: '2026-11-10T15:30' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn on maintenance' })); });

    expect(window.confirm).toHaveBeenCalled();
    expect(maintenancePut.mock.calls[0][1].headers).toMatchObject({ 'x-csrf-token': 'csrf-1' });
    expect(putBody()).toEqual({ enabled: true, message: 'Upgrading', until: new Date('2026-11-10T15:30').toISOString() });
    expect(await screen.findByText('ON: players see the maintenance page')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Maintenance mode is ON: players now see the maintenance page.');
    expect(toast.success).toHaveBeenCalledWith('Cloudflare cache purged: every page follows the switch now.', { duration: 10_000 });
    expect(screen.getByText(/Last changed .* by admin@example.test/)).toBeInTheDocument();
  });

  it('does nothing when the admin cancels the confirmation', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<MaintenanceModeCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on maintenance' }));
    expect(maintenancePut).not.toHaveBeenCalled();
  });

  it('saves a new message while on (no confirmation), and turns it off with a purge reminder', async () => {
    maintenanceGet = async () => jsonResponse({ maintenance: { ...on, until: '2026-11-10T10:30:00Z', updatedBy: null, autoPurge: false } });
    maintenancePut.mockImplementation(async (_u, init) => {
      const body = JSON.parse(init.body as string);
      return body.enabled
        ? jsonResponse({ maintenance: { ...on, autoPurge: false }, purge: 'unchanged' })
        : jsonResponse({ maintenance: { ...off, autoPurge: false }, purge: 'skipped' });
    });
    render(<MaintenanceModeCard />);
    expect(await screen.findByDisplayValue('Upgrading')).toBeInTheDocument();
    expect((screen.getByLabelText(/Back by/) as HTMLInputElement).value).toBe(toLocalInput('2026-11-10T10:30:00Z'));
    expect(screen.getByText(/visitors who aren.t signed in still get/)).toBeInTheDocument();
    expect(screen.getByText(/^Last changed/).textContent).not.toContain(' by ');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save message' })); });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Maintenance message saved.');
    expect(toast.warning).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Back by/), { target: { value: '' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn off maintenance' })); });
    expect(putBody()).toMatchObject({ enabled: false, until: null });
    expect(toast.success).toHaveBeenCalledWith('Maintenance mode is OFF: the site is open again.');
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('get the site back'), { duration: 10_000 });
  });

  it('reminds the admin to purge after turning it on without auto-purge', async () => {
    maintenanceGet = async () => jsonResponse({ maintenance: { ...off, autoPurge: false } });
    maintenancePut.mockResolvedValue(jsonResponse({ maintenance: { ...on, autoPurge: false }, purge: 'skipped' }));
    render(<MaintenanceModeCard />);
    const turnOn = await screen.findByRole('button', { name: 'Turn on maintenance' });
    await act(async () => { fireEvent.click(turnOn); });
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('see the maintenance page'), { duration: 10_000 });
  });

  it('warns about a failed purge and the env override', async () => {
    maintenanceGet = async () => jsonResponse({ maintenance: { ...off, forcedByEnv: true } });
    maintenancePut.mockResolvedValue(jsonResponse({ maintenance: on, purge: 'failed' }));
    render(<MaintenanceModeCard />);
    expect(await screen.findByText(/MAINTENANCE_MODE=true is set on the server/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn on maintenance' })); });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't purge"), { duration: 10_000 });
  });

  it('reports a refused save, keeps the old state, and works without a CSRF token', async () => {
    csrf = async () => { throw new Error('offline'); };
    maintenancePut.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));
    render(<MaintenanceModeCard />);
    const turnOn = await screen.findByRole('button', { name: 'Turn on maintenance' });
    await act(async () => { fireEvent.click(turnOn); });
    expect(toast.error).toHaveBeenCalledWith('Unauthorized');
    expect(maintenancePut.mock.calls[0][1].headers).toEqual({ 'content-type': 'application/json' });
    expect(screen.getByText('OFF: site is open')).toBeInTheDocument();

    maintenancePut.mockResolvedValueOnce(jsonResponse({}, 500));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn on maintenance' })); });
    expect(toast.error).toHaveBeenLastCalledWith('Failed to update maintenance mode');

    maintenancePut.mockRejectedValueOnce('boom');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn on maintenance' })); });
    expect(toast.error).toHaveBeenLastCalledWith('Failed to update maintenance mode');
  });

  it('says so when the setting cannot be loaded', async () => {
    maintenanceGet = async () => jsonResponse({ error: 'Unauthorized' }, 401);
    render(<MaintenanceModeCard />);
    await waitFor(() => expect(screen.getByText(/Couldn.t load the maintenance setting/)).toBeInTheDocument());
    expect(screen.queryByLabelText('Loading')).toBeNull();
  });
});

describe('toLocalInput', () => {
  it('is empty without a time', () => expect(toLocalInput(null)).toBe(''));
});
