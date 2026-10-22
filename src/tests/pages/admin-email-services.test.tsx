import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import type { EmailServicesOverview } from '@/lib/mail/admin';

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: async () => ({ 'x-csrf-token': 'tok' }) }));

import AdminEmailServicesPage from '@/app/admin/(protected)/email/page';

const baseOverview = (): EmailServicesOverview => ({
  selected: 'brevo',
  active: 'brevo',
  sesConfigured: true,
  sesRegion: 'ap-southeast-2',
  limits: { brevo: 299, ses: 45000, reserve: 20 },
  quota: { used: 120, limit: 299, reserve: 20, cap: 279, remaining: 179, capRemaining: 159, nextFreeAt: '2099-01-01T15:15:00Z' },
  totals: [
    { provider: 'brevo', period: '24h', status: 'accepted', count: 100 },
    { provider: 'brevo', period: '24h', status: 'failed', count: 2 },
    { provider: 'brevo', period: '30d', status: 'delivered', count: 900 },
    { provider: 'brevo', period: '30d', status: 'bounced', count: 4 },
    { provider: 'ses', period: '30d', status: 'accepted', count: 7 },
  ],
  recentFailures: { count: 0, lastError: null, lastAt: null },
  ses: { ok: true, data: { max24HourSend: 50000, maxSendRate: 14, sentLast24Hours: 12, productionAccess: true, sendingEnabled: true, enforcementStatus: 'HEALTHY' } },
  brevo: { ok: true, data: [{ type: 'free', credits: 300, creditsType: 'sendLimit', endDate: null }, { type: 'sms', credits: 5, creditsType: 'credits', endDate: '2026-12-01' }] },
  awsCost: { configured: true, error: null, refreshAvailableAt: null, cost: { monthToDate: { amount: 1.5, unit: 'USD', estimated: true }, forecastRest: { amount: 2.25, unit: 'USD' }, fetchedAt: '2099-01-01T10:00:00Z' } },
});

const logEntries = [
  { id: 1, sentAt: '2099-01-01T10:00:00Z', kind: 'registration', recipient: 'fan@example.test', subject: 'Confirm your account', provider: 'ses', status: 'bounced', providerMessageId: 'm1', error: '550 no such user' },
  { id: 2, sentAt: '2099-01-01T09:00:00Z', kind: 'mystery', recipient: 'b@example.test', subject: 'Hi', provider: 'brevo', status: 'queued', providerMessageId: null, error: null },
];

let overview: EmailServicesOverview;
let routes: { overview?: () => Response | Promise<Response>; put?: () => Response; log?: (url: string) => Response; refresh?: () => Response };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  overview = baseOverview();
  routes = {};
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/admin/email-log')) return routes.log?.(url) ?? jsonResponse({ success: true, entries: logEntries, total: 2, pageSize: 50 });
    if (url.endsWith('/refresh-billing')) return routes.refresh?.() ?? jsonResponse({ success: true, awsCost: { ...overview.awsCost, refreshAvailableAt: '2099-01-01T11:00:00Z' } });
    if (init?.method === 'PUT') return routes.put?.() ?? jsonResponse({ success: true });
    return routes.overview?.() ?? jsonResponse({ success: true, overview });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const loaded = () => screen.findByRole('heading', { name: 'Email Services' });
const calls = (match: string) => fetchMock.mock.calls.filter(([url]) => url.includes(match));
const section = (label: string) => within(screen.getByRole('region', { name: label }));

describe('admin email services page', () => {
  it('shows the selected service, counts, billing and the log', async () => {
    render(<AdminEmailServicesPage />);
    expect(screen.getByText('Loading email services…')).toBeInTheDocument();
    await loaded();
    expect(screen.getByRole('button', { name: /Brevo \(selected\)/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Amazon SES/ })).toHaveTextContent('Daily limit 45,000 emails · ap-southeast-2');
    expect(screen.queryByRole('alert')).toBeNull();

    const sent = section('Emails sent');
    expect(sent.getByText(/120 \/ 299/)).toBeInTheDocument();
    expect(sent.getByText(/next frees up/)).toBeInTheDocument();
    expect(sent.getByText('100 sent, 2 failed')).toBeInTheDocument();
    expect(sent.getByText('904 sent, 4 bounced')).toBeInTheDocument();
    expect(sent.getByText('7 sent')).toBeInTheDocument();
    expect(sent.getByText('AWS quota: 12 of 50,000 used in 24 hours, up to 14 a second.')).toBeInTheDocument();

    const billing = section('Billing');
    expect(billing.getByText('$1.50')).toBeInTheDocument();
    expect(billing.getByText('$3.75')).toBeInTheDocument();
    expect(billing.getByText(/\(estimated\)/)).toBeInTheDocument();
    expect(billing.getByText(/300 emails left/)).toBeInTheDocument();
    expect(billing.getByText(/5 credits left · renews 2026-12-01/)).toBeInTheDocument();

    const log = section('Email log');
    expect(await log.findByText('fan@example.test')).toBeInTheDocument();
    expect(log.getByRole('cell', { name: 'Registration' })).toBeInTheDocument();
    expect(log.getByRole('cell', { name: 'mystery' })).toBeInTheDocument();
    expect(log.getByText('queued')).toBeInTheDocument();
    expect(log.getByText('550 no such user')).toBeInTheDocument();
    expect(log.getByText('2 emails')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][1].headers['x-csrf-token']).toBe('tok');
  });

  it('switches to AWS after confirming, and not without', async () => {
    render(<AdminEmailServicesPage />);
    await loaded();
    vi.mocked(confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /Amazon SES/ }));
    expect(calls('/api/admin/email-services').filter(([, i]) => i?.method === 'PUT')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Amazon SES/ }));
    expect(confirm).toHaveBeenLastCalledWith('Send all email through Amazon SES from now on? Its daily limit is 45,000 emails.');
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Emails now go through Amazon SES (within a minute on every server).'));
    const put = calls('/api/admin/email-services').find(([, i]) => i?.method === 'PUT')!;
    expect(JSON.parse(put[1].body)).toEqual({ provider: 'ses' });
    await waitFor(() => expect(calls('/api/admin/email-services').filter(([, i]) => !i?.method)).toHaveLength(2));
  });

  it('reports a switch that fails', async () => {
    const answers = [jsonResponse({ success: false, message: "Amazon SES isn't set up" }, 400), jsonResponse({}, 500)];
    routes.put = () => answers.shift()!;
    render(<AdminEmailServicesPage />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /Amazon SES/ }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith("Amazon SES isn't set up"));
    fireEvent.click(screen.getByRole('button', { name: /Amazon SES/ }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Could not save the change.'));
  });

  it('alerts on failed sends with a switch to the other service', async () => {
    overview = { ...baseOverview(), selected: 'ses', active: 'ses', recentFailures: { count: 3, lastError: 'AWS paused sending for this account', lastAt: '2099-01-01T09:59:00Z' } };
    render(<AdminEmailServicesPage />);
    await loaded();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('3 emails failed through Amazon SES in the last hour.');
    expect(alert).toHaveTextContent('Last error: AWS paused sending for this account');
    fireEvent.click(within(alert).getByRole('button', { name: 'Switch to Brevo' }));
    expect(confirm).toHaveBeenLastCalledWith('Send all email through Brevo from now on? Its daily limit is 299 emails.');
    await waitFor(() => expect(JSON.parse(calls('/api/admin/email-services').find(([, i]) => i?.method === 'PUT')![1].body)).toEqual({ provider: 'brevo' }));
  });

  it('alerts without a switch when the other service is not set up', async () => {
    overview = { ...baseOverview(), sesConfigured: false, ses: null, awsCost: { configured: false, cost: null, error: null, refreshAvailableAt: null }, recentFailures: { count: 1, lastError: null, lastAt: null } };
    render(<AdminEmailServicesPage />);
    await loaded();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('1 email failed through Brevo in the last hour.');
    expect(alert).not.toHaveTextContent('Last error');
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: /Amazon SES/ })).toBeDisabled();
    expect(screen.getByText('Not set up: add the AWS access key in hPanel')).toBeInTheDocument();
    expect(screen.queryByLabelText('SES daily limit')).toBeNull();
    expect(screen.getByText('Add the AWS access key in hPanel to see AWS billing.')).toBeInTheDocument();
    expect(section('Billing').queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('warns about SES being selected without a key, the sandbox, and account problems', async () => {
    overview = {
      ...baseOverview(),
      selected: 'ses',
      active: 'brevo',
      ses: { ok: true, data: { max24HourSend: 200, maxSendRate: 1, sentLast24Hours: 0, productionAccess: false, sendingEnabled: false, enforcementStatus: null } },
    };
    const { unmount } = render(<AdminEmailServicesPage />);
    await loaded();
    expect(screen.getByText('Amazon SES is selected but has no access key on the server, so emails go through Brevo.')).toBeInTheDocument();
    expect(screen.getByText('AWS SES is still in its sandbox: it only sends to verified addresses, at most 200 a day.')).toBeInTheDocument();
    expect(screen.getByText('AWS reports a problem with this account: sending is paused, status unknown.')).toBeInTheDocument();
    unmount();

    overview = { ...baseOverview(), ses: { ok: true, data: { max24HourSend: 50000, maxSendRate: 14, sentLast24Hours: 12, productionAccess: true, sendingEnabled: true, enforcementStatus: 'PROBATION' } } };
    const second = render(<AdminEmailServicesPage />);
    await loaded();
    expect(screen.getByText('AWS reports a problem with this account: sending is on, status PROBATION.')).toBeInTheDocument();
    second.unmount();

    overview = { ...baseOverview(), ses: { ok: false, error: 'AccessDeniedException' } };
    render(<AdminEmailServicesPage />);
    await loaded();
    expect(screen.getByText('AWS SES status: AccessDeniedException')).toBeInTheDocument();
  });

  it('saves the SES daily limit, and refuses something that is not a whole number', async () => {
    render(<AdminEmailServicesPage />);
    await loaded();
    const field = screen.getByLabelText('SES daily limit');
    expect(field).toHaveValue(45000);
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));
    expect(h.toast.error).toHaveBeenCalledWith('Enter a whole number of emails.');
    fireEvent.change(field, { target: { value: '40000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('The SES daily limit is saved.'));
    expect(JSON.parse(calls('/api/admin/email-services').find(([, i]) => i?.method === 'PUT')![1].body)).toEqual({ sesDailyLimit: 40000 });
  });

  it('shows billing states: no forecast yet, other currencies, errors, and Brevo problems', async () => {
    overview = {
      ...baseOverview(),
      quota: { ...baseOverview().quota!, nextFreeAt: null },
      awsCost: { configured: true, error: 'AWS billing could not be read: AccessDeniedException', refreshAvailableAt: '2099-01-01T11:00:00Z', cost: { monthToDate: { amount: 2, unit: 'EUR', estimated: false }, forecastRest: null, fetchedAt: '2099-01-01T10:00:00Z' } },
      brevo: { ok: false, error: 'Brevo answered 401: Key not found' },
    };
    const { unmount } = render(<AdminEmailServicesPage />);
    await loaded();
    const billing = section('Billing');
    expect(billing.getByText('2.00 EUR')).toBeInTheDocument();
    expect(billing.queryByText(/\(estimated\)/)).toBeNull();
    expect(billing.getByText('no forecast yet (AWS needs more history)')).toBeInTheDocument();
    expect(billing.getByText('AWS billing could not be read: AccessDeniedException')).toBeInTheDocument();
    expect(billing.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(billing.getByText('Brevo answered 401: Key not found')).toBeInTheDocument();
    expect(section('Emails sent').queryByText(/next frees up/)).toBeNull();
    unmount();

    overview = { ...baseOverview(), quota: null, brevo: null };
    const second = render(<AdminEmailServicesPage />);
    await loaded();
    expect(screen.getByText('No Brevo API key on the server.')).toBeInTheDocument();
    expect(section('Emails sent').queryByText(/Last 24 hours/)).toBeNull();
    second.unmount();

    overview = { ...baseOverview(), brevo: { ok: true, data: [{ type: 'free', credits: null, creditsType: null, endDate: null }] } };
    const third = render(<AdminEmailServicesPage />);
    await loaded();
    expect(section('Billing').getByText('free')).toBeInTheDocument();
    third.unmount();

    overview = { ...baseOverview(), brevo: { ok: true, data: [] } };
    render(<AdminEmailServicesPage />);
    await loaded();
    expect(screen.getByText('Brevo reported no plan.')).toBeInTheDocument();
  });

  it('refreshes the AWS billing, then waits an hour before the next refresh', async () => {
    render(<AdminEmailServicesPage />);
    await loaded();
    fireEvent.click(section('Billing').getByRole('button', { name: 'Refresh' }));
    expect(await section('Billing').findByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    await waitFor(() => expect(section('Billing').getByRole('button', { name: 'Refresh' })).toBeDisabled());
    expect(calls('/refresh-billing')[0][1].method).toBe('POST');
  });

  it('reports a billing refresh that fails', async () => {
    const answers = [jsonResponse({ success: false, message: 'Too soon' }, 400), jsonResponse({}, 500)];
    routes.refresh = () => answers.shift()!;
    render(<AdminEmailServicesPage />);
    await loaded();
    fireEvent.click(section('Billing').getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Too soon'));
    fireEvent.click(section('Billing').getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Could not refresh the AWS billing.'));
  });

  it('searches, filters and pages through the log', async () => {
    routes.log = (url) => jsonResponse({ success: true, entries: url.includes('page=1') ? logEntries : [], total: 120, pageSize: 50 });
    render(<AdminEmailServicesPage />);
    await loaded();
    const log = section('Email log');
    await log.findByText('fan@example.test');
    expect(log.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(log.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(log.getByRole('button', { name: 'Next' }));
    expect(await log.findByText('No emails match.')).toBeInTheDocument();
    expect(log.getByText('Page 2 of 3')).toBeInTheDocument();
    fireEvent.click(log.getByRole('button', { name: 'Previous' }));
    await log.findByText('fan@example.test');

    fireEvent.change(log.getByLabelText('Search the email log'), { target: { value: '  fan  ' } });
    fireEvent.submit(log.getByLabelText('Search the email log').closest('form')!);
    fireEvent.change(log.getByLabelText('Service'), { target: { value: 'ses' } });
    fireEvent.change(log.getByLabelText('Result'), { target: { value: 'bounced' } });
    fireEvent.change(log.getByLabelText('Type'), { target: { value: 'registration' } });
    await waitFor(() => expect(calls('/api/admin/email-log').at(-1)![0]).toBe('/api/admin/email-log?page=1&q=fan&provider=ses&status=bounced&kind=registration'));
  });

  it('shows a log total of one, and reports a log that cannot load', async () => {
    const answers = [jsonResponse({ success: true, entries: [logEntries[0]], total: 1, pageSize: 50 }), jsonResponse({ success: false, message: 'Invalid filter.' }, 400), jsonResponse({}, 500)];
    routes.log = () => answers.shift() ?? jsonResponse({}, 500);
    render(<AdminEmailServicesPage />);
    await loaded();
    expect(await screen.findByText('1 email')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'ses' } });
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Invalid filter.'));
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'brevo' } });
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Could not load the email log.'));
  });

  it('shows a load error with a retry, then the page', async () => {
    const answers = [jsonResponse({ success: false, message: 'Could not load the email services.' }, 500), jsonResponse({}, 500)];
    routes.overview = () => answers.shift() ?? jsonResponse({ success: true, overview });
    render(<AdminEmailServicesPage />);
    expect(await screen.findByText('Could not load the email services.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls('/api/admin/email-services')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
  });

  it('reloads everything from the Refresh button at the top', async () => {
    render(<AdminEmailServicesPage />);
    await loaded();
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', { name: /Refresh/ })[0]);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 2));
  });
});
