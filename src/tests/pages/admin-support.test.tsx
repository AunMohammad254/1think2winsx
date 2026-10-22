import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  lookupUserAction: vi.fn(),
  adjustUserBalanceAction: vi.fn(),
  updateUserProfileAction: vi.fn(),
  updateUserPasswordAction: vi.fn(),
  suspendUserAction: vi.fn(),
  forceVerifyEmailAction: vi.fn(),
  resendVerificationEmailAction: vi.fn(),
  generateImpersonationLinkAction: vi.fn(),
  sendNotificationAction: vi.fn(),
  refundQuizAttemptAction: vi.fn(),
  getUserSecurityLogsAction: vi.fn(),
  addAdminNoteAction: vi.fn(),
  getAdminNotesAction: vi.fn(),
  generateGDPRExportAction: vi.fn(),
}));
vi.mock('@/actions/support-actions', () => h);

import UserSupportPage from '@/app/admin/(protected)/support/page';

const user = { id: 'user-1', name: 'Ali Khan', phone: '0300', points: 1500, walletBalance: 250 };
const when = '2026-10-01T10:00:00Z';
const attempts = [
  { id: 'a1', Quiz: { title: 'Cricket' }, createdAt: when, score: 8, totalQuestions: 10, isWinner: true },
  { id: 'a2', createdAt: when, score: 2, totalQuestions: 10, isWinner: false },
];
const redemptions = [
  { id: 'r1', Prize: { name: 'Phone' }, createdAt: when, pointsUsed: 900, status: 'completed' },
  { id: 'r2', Prize: { name: 'Watch' }, createdAt: when, pointsUsed: 300, status: 'rejected' },
  { id: 'r3', createdAt: when, pointsUsed: 100, status: 'pending' },
];
const logs = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((severity, i) => ({ id: `l${i}`, type: `EVENT_${severity}`, details: { i }, createdAt: when, severity }));
const notes = [
  { id: 'n1', createdAt: when, details: { note: 'Warned for spam', tags: ['VIP', 'Suspicious'], adminEmail: 'boss@x.com' } },
  { id: 'n2', createdAt: when, details: { note: 'Called the user', adminEmail: 'boss@x.com' } },
];
const ok = (extra: Record<string, unknown> = {}) => ({ success: true, ...extra });
const fail = (error?: string) => ({ success: false, error });
const never = () => new Promise(() => {});

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset().mockResolvedValue(ok());
  h.lookupUserAction.mockResolvedValue(ok({ user, redemptions, attempts }));
  h.getUserSecurityLogsAction.mockResolvedValue(ok({ logs }));
  h.getAdminNotesAction.mockResolvedValue(ok({ notes }));
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('prompt', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const byPlaceholder = (text: string | RegExp) => screen.getByPlaceholderText(text);
const type = (text: string | RegExp, value: string) => fireEvent.change(byPlaceholder(text), { target: { value } });
const submitFor = (text: string | RegExp) => fireEvent.submit(byPlaceholder(text).closest('form')!);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const success = (text: string) => screen.findByText(text, { selector: '.text-green-200' });
const failure = (text: string) => screen.findByText(text, { selector: '.text-red-200' });
const search = async (q = 'ali@x.com') => {
  type('Enter User ID or Email address...', q);
  submitFor('Enter User ID or Email address...');
  await screen.findByText('User Details');
};

describe('admin user support page', () => {
  it('looks a user up and shows their records', async () => {
    render(<UserSupportPage />);
    await search();
    expect(h.lookupUserAction).toHaveBeenCalledWith('ali@x.com');
    expect(h.getUserSecurityLogsAction).toHaveBeenCalledWith('user-1');
    expect(h.getAdminNotesAction).toHaveBeenCalledWith('user-1');
    expect(screen.getByText('Ali Khan')).toBeInTheDocument();
    expect(screen.getByText('0300')).toBeInTheDocument();
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.getByText('PKR 250')).toBeInTheDocument();

    expect(screen.getByText('Cricket')).toBeInTheDocument();
    expect(screen.getByText('Unknown Quiz')).toBeInTheDocument();
    expect(screen.getByText('Winner').className).toContain('text-yellow-300');
    expect(screen.getByText('Completed').className).toContain('text-gray-300');

    expect(screen.getByText('Unknown Prize')).toBeInTheDocument();
    expect(screen.getByText('completed').className).toContain('text-green-300');
    expect(screen.getByText('rejected').className).toContain('text-red-300');
    expect(screen.getByText('pending').className).toContain('text-yellow-300');

    const severity = (s: string) => within(screen.getByText(`EVENT_${s}`).parentElement!.parentElement!).getByText(s).className;
    expect(severity('CRITICAL')).toContain('text-red-300');
    expect(severity('HIGH')).toContain('text-orange-300');
    expect(severity('MEDIUM')).toContain('text-yellow-300');
    expect(severity('LOW')).toContain('text-blue-300');

    expect(screen.getByText('Warned for spam')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getAllByText('By boss@x.com')).toHaveLength(2);
  });

  it('shows fallbacks for sparse users and missing logs or notes', async () => {
    h.lookupUserAction.mockResolvedValue(ok({ user: { id: 'u2' } }));
    h.getUserSecurityLogsAction.mockResolvedValueOnce(fail()).mockResolvedValueOnce(ok());
    h.getAdminNotesAction.mockResolvedValueOnce(ok()).mockResolvedValueOnce(fail());
    render(<UserSupportPage />);
    await search('u2');
    expect(screen.getAllByText('N/A')).toHaveLength(2);
    expect(screen.getByText('PKR')).toBeInTheDocument();
    expect(screen.getByText('No recent quiz attempts found.')).toBeInTheDocument();
    expect(screen.getByText('No prize redemptions found.')).toBeInTheDocument();
    expect(screen.getByText('No recent security logs found.')).toBeInTheDocument();
    expect(screen.getByText('No internal notes for this user.')).toBeInTheDocument();
    await search('u2');
    expect(screen.getByText('No recent security logs found.')).toBeInTheDocument();
  });

  it('ignores blank searches and reports lookup failures', async () => {
    render(<UserSupportPage />);
    type('Enter User ID or Email address...', '   ');
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    submitFor('Enter User ID or Email address...');
    expect(h.lookupUserAction).not.toHaveBeenCalled();

    type('Enter User ID or Email address...', 'nobody');
    h.lookupUserAction.mockResolvedValueOnce(fail('Bad query'));
    submitFor('Enter User ID or Email address...');
    expect(await failure('Bad query')).toBeInTheDocument();
    h.lookupUserAction.mockResolvedValueOnce(fail());
    submitFor('Enter User ID or Email address...');
    expect(await failure('User not found')).toBeInTheDocument();
    h.lookupUserAction.mockResolvedValueOnce(ok({ user: null }));
    submitFor('Enter User ID or Email address...');
    await waitFor(() => expect(h.lookupUserAction).toHaveBeenCalledTimes(3));
    expect(await failure('User not found')).toBeInTheDocument();

    h.lookupUserAction.mockReturnValueOnce(never());
    submitFor('Enter User ID or Email address...');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Search' })).toBeNull());
  });

  it('adjusts points and wallet balances', async () => {
    render(<UserSupportPage />);
    await search();
    expect(screen.getByRole('button', { name: 'Apply Adjustment' })).toBeDisabled();
    submitFor('e.g. 500 or -100');
    expect(h.adjustUserBalanceAction).not.toHaveBeenCalled();

    type('e.g. Compensation for missing quiz', 'Ticket 42');
    for (const bad of ['0', '.5']) {
      type('e.g. 500 or -100', bad);
      submitFor('e.g. 500 or -100');
      expect(await failure('Please enter a valid non-zero amount')).toBeInTheDocument();
    }

    click('Wallet');
    expect(screen.getByRole('button', { name: 'Wallet' }).className).toContain('text-emerald-300');
    type('e.g. 500 or -100', '-100');
    h.lookupUserAction.mockResolvedValueOnce(ok({ user: { ...user, walletBalance: 150 } }));
    submitFor('e.g. 500 or -100');
    expect(await success('Successfully adjusted wallet by -100.')).toBeInTheDocument();
    expect(h.adjustUserBalanceAction).toHaveBeenLastCalledWith('user-1', 'wallet', -100, 'Ticket 42');
    expect(h.lookupUserAction).toHaveBeenLastCalledWith('user-1');
    expect(screen.getByText('PKR 150')).toBeInTheDocument();
    expect(byPlaceholder('e.g. 500 or -100')).toHaveValue(null);
    expect(byPlaceholder('e.g. Compensation for missing quiz')).toHaveValue('');

    click('Points');
    expect(screen.getByRole('button', { name: 'Points' }).className).toContain('text-purple-300');
    const adjust = async (amount: string) => {
      type('e.g. 500 or -100', amount);
      type('e.g. Compensation for missing quiz', 'Ticket 43');
      submitFor('e.g. 500 or -100');
    };
    h.lookupUserAction.mockResolvedValueOnce(fail());
    await adjust('50');
    expect(await success('Successfully adjusted points by 50.')).toBeInTheDocument();
    expect(screen.getByText('PKR 150')).toBeInTheDocument(); // a failed refresh keeps what's shown

    h.adjustUserBalanceAction.mockResolvedValueOnce(fail('Insufficient funds'));
    await adjust('-5000');
    expect(await failure('Insufficient funds')).toBeInTheDocument();
    h.adjustUserBalanceAction.mockResolvedValueOnce(fail());
    await adjust('-5000');
    expect(await failure('Failed to adjust balance')).toBeInTheDocument();
  });

  it('edits the profile', async () => {
    render(<UserSupportPage />);
    await search();
    click(/Edit Profile/);
    click('Cancel');
    expect(screen.queryByDisplayValue('Ali Khan')).toBeNull();
    click(/Edit Profile/);
    click(/Edit Profile/);
    expect(screen.queryByDisplayValue('Ali Khan')).toBeNull();

    click(/Edit Profile/);
    fireEvent.change(screen.getByDisplayValue('Ali Khan'), { target: { value: 'Ali K' } });
    fireEvent.change(screen.getByDisplayValue('0300'), { target: { value: '0311' } });
    click(/Save/);
    expect(await success('Profile updated successfully.')).toBeInTheDocument();
    expect(h.updateUserProfileAction).toHaveBeenCalledWith('user-1', { name: 'Ali K', phone: '0311' });
    expect(screen.getByText('Ali K')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    click(/Edit Profile/);
    h.updateUserProfileAction.mockResolvedValueOnce(fail('Phone taken'));
    click(/Save/);
    expect(await failure('Phone taken')).toBeInTheDocument();
    h.updateUserProfileAction.mockResolvedValueOnce(fail());
    click(/Save/);
    expect(await failure('Failed to update profile')).toBeInTheDocument();
  });

  it('resets the password', async () => {
    render(<UserSupportPage />);
    await search();
    type('Enter new strong password', 'short');
    expect(screen.getByRole('button', { name: 'Force Change Password' })).toBeDisabled();
    submitFor('Enter new strong password');
    expect(await failure('Password must be at least 8 characters long')).toBeInTheDocument();

    type('Enter new strong password', 'longpassword');
    click('Force Change Password');
    expect(await success('Password changed successfully.')).toBeInTheDocument();
    expect(h.updateUserPasswordAction).toHaveBeenCalledWith('user-1', 'longpassword');
    expect(byPlaceholder('Enter new strong password')).toHaveValue('');

    type('Enter new strong password', 'longpassword');
    h.updateUserPasswordAction.mockResolvedValueOnce(fail('Weak password'));
    click('Force Change Password');
    expect(await failure('Weak password')).toBeInTheDocument();
    h.updateUserPasswordAction.mockResolvedValueOnce(fail());
    click('Force Change Password');
    expect(await failure('Failed to change password')).toBeInTheDocument();
  });

  it('suspends, verifies and impersonates accounts', async () => {
    render(<UserSupportPage />);
    await search();
    vi.mocked(confirm).mockReturnValueOnce(false);
    click('Suspend');
    expect(h.suspendUserAction).not.toHaveBeenCalled();
    click('Suspend');
    expect(await success('User suspended successfully.')).toBeInTheDocument();
    expect(h.suspendUserAction).toHaveBeenCalledWith('user-1', true);
    h.suspendUserAction.mockResolvedValueOnce(fail('Already suspended'));
    click('Suspend');
    expect(await failure('Already suspended')).toBeInTheDocument();

    click('Send Verification');
    expect(await success('Verification email sent to the user.')).toBeInTheDocument();
    h.resendVerificationEmailAction.mockResolvedValueOnce(fail('Already verified'));
    click('Send Verification');
    expect(await failure('Already verified')).toBeInTheDocument();

    const forceVerify = /Force Verify Email/;
    vi.mocked(confirm).mockReturnValueOnce(false);
    click(forceVerify);
    expect(h.forceVerifyEmailAction).not.toHaveBeenCalled();
    click(forceVerify);
    expect(await success('Email forcefully verified (Backup).')).toBeInTheDocument();
    h.forceVerifyEmailAction.mockResolvedValueOnce(fail('No auth user'));
    click(forceVerify);
    expect(await failure('No auth user')).toBeInTheDocument();

    h.generateImpersonationLinkAction.mockResolvedValueOnce(ok({ link: 'https://magic' }));
    click('Login As');
    expect(await success('Impersonation link generated! Check below.')).toBeInTheDocument();
    expect(prompt).toHaveBeenCalledWith('Copy this magic link and open it in an Incognito window:', 'https://magic');
    h.generateImpersonationLinkAction.mockResolvedValueOnce(fail('Not allowed'));
    click('Login As');
    expect(await failure('Not allowed')).toBeInTheDocument();
  });

  it('replaces the previous banner on each account action, so success and error never show together', async () => {
    render(<UserSupportPage />);
    await search();
    click('Send Verification');
    await success('Verification email sent to the user.');
    h.suspendUserAction.mockResolvedValueOnce(fail('Already suspended'));
    click('Suspend');
    await failure('Already suspended');
    expect(screen.queryByText('Verification email sent to the user.')).toBeNull();
    click('Send Verification');
    await success('Verification email sent to the user.');
    expect(screen.queryByText('Already suspended')).toBeNull();
  });

  it('sends a notification, optionally by email', async () => {
    render(<UserSupportPage />);
    await search();
    submitFor('e.g. Account Credited');
    expect(h.sendNotificationAction).not.toHaveBeenCalled();
    const send = (email: boolean) => {
      type('e.g. Account Credited', 'Credited');
      type('Your detailed message...', 'We added 500 points');
      if (email) fireEvent.click(screen.getByRole('checkbox'));
      click('Dispatch Message');
    };
    h.sendNotificationAction.mockResolvedValueOnce(ok({ emailSent: true }));
    send(true);
    expect(await success('Notification sent directly to user dashboard and via Email!')).toBeInTheDocument();
    expect(h.sendNotificationAction).toHaveBeenCalledWith('user-1', 'Credited', 'We added 500 points', true);
    expect(byPlaceholder('e.g. Account Credited')).toHaveValue('');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    send(false);
    expect(await success('Notification sent directly to user dashboard.')).toBeInTheDocument();
    // today's email limit: the notification is saved and the admin is told why no email went out
    h.sendNotificationAction.mockResolvedValueOnce(ok({ emailSent: false, emailError: "Today's email limit has been reached." }));
    send(true);
    expect(await success("Notification sent directly to user dashboard. The email was not sent: Today's email limit has been reached.")).toBeInTheDocument();
    h.sendNotificationAction.mockResolvedValueOnce(fail('Mailer down'));
    send(false);
    expect(await failure('Mailer down')).toBeInTheDocument();
  });

  it('refunds quiz attempts', async () => {
    render(<UserSupportPage />);
    await search();
    const refund = () => fireEvent.click(screen.getAllByRole('button', { name: /Refund & Delete/ })[0]);
    vi.mocked(confirm).mockReturnValueOnce(false);
    refund();
    expect(h.refundQuizAttemptAction).not.toHaveBeenCalled();
    h.refundQuizAttemptAction.mockResolvedValueOnce(fail('Already refunded'));
    refund();
    expect(await failure('Already refunded')).toBeInTheDocument();
    refund();
    expect(await success('Quiz attempt refunded and deleted.')).toBeInTheDocument();
    expect(h.refundQuizAttemptAction).toHaveBeenLastCalledWith('a1');
    expect(screen.queryByText('Cricket')).toBeNull();
    expect(screen.getByText('Unknown Quiz')).toBeInTheDocument();
  });

  it('adds internal notes with tags', async () => {
    render(<UserSupportPage />);
    await search();
    submitFor(/Add a private note/);
    expect(h.addAdminNoteAction).not.toHaveBeenCalled();

    type(/Add a private note/, 'Asked for a refund');
    type(/Tags \(comma separated/, 'VIP, , Refund');
    h.getAdminNotesAction.mockResolvedValueOnce(ok({ notes: [{ id: 'n3', createdAt: when, details: { note: 'Asked for a refund', tags: ['VIP', 'Refund'], adminEmail: 'boss@x.com' } }] }));
    click(/Add Note/);
    expect(await success('Admin note added successfully.')).toBeInTheDocument();
    expect(h.addAdminNoteAction).toHaveBeenLastCalledWith('user-1', 'Asked for a refund', ['VIP', 'Refund']);
    expect(screen.getByText('Asked for a refund')).toBeInTheDocument();
    expect(byPlaceholder(/Add a private note/)).toHaveValue('');
    expect(byPlaceholder(/Tags \(comma separated/)).toHaveValue('');

    type(/Add a private note/, 'Untagged');
    h.getAdminNotesAction.mockResolvedValueOnce(fail());
    click(/Add Note/);
    await waitFor(() => expect(h.addAdminNoteAction).toHaveBeenLastCalledWith('user-1', 'Untagged', []));
    await waitFor(() => expect(byPlaceholder(/Add a private note/)).toHaveValue(''));
    expect(screen.getByText('Asked for a refund')).toBeInTheDocument(); // a failed reload keeps the list

    type(/Add a private note/, 'Third');
    h.getAdminNotesAction.mockResolvedValueOnce(ok());
    click(/Add Note/);
    expect(await screen.findByText('No internal notes for this user.')).toBeInTheDocument();

    type(/Add a private note/, 'Fourth');
    h.addAdminNoteAction.mockResolvedValueOnce(fail('Too long'));
    click(/Add Note/);
    expect(await failure('Too long')).toBeInTheDocument();
  });

  it('exports the user data as a JSON download', async () => {
    const createObjectURL = vi.fn(() => 'blob:export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    render(<UserSupportPage />);
    await search();

    h.generateGDPRExportAction.mockResolvedValueOnce(ok({ data: { user } }));
    click('GDPR Export');
    expect(await success('GDPR Data Exported successfully.')).toBeInTheDocument();
    expect(clicks[0].download).toBe('user_export_user-1.json');
    expect(clicks[0].href).toBe('blob:export');
    expect(clicks[0].isConnected).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');

    h.generateGDPRExportAction.mockResolvedValueOnce(fail('Export failed'));
    click('GDPR Export');
    expect(await failure('Export failed')).toBeInTheDocument();
    h.generateGDPRExportAction.mockResolvedValueOnce(ok({ data: null, error: 'Nothing to export' }));
    click('GDPR Export');
    expect(await failure('Nothing to export')).toBeInTheDocument();
    expect(clicks).toHaveLength(1);
  });

  it('disables each action while it runs', async () => {
    render(<UserSupportPage />);
    await search();
    for (const fn of Object.values(h)) fn.mockReturnValue(never());

    click(/Edit Profile/);
    const save = screen.getByRole('button', { name: /Save/ });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());

    for (const name of ['Suspend', 'Send Verification', 'Login As', 'GDPR Export', /Force Verify Email/]) {
      const button = screen.getByRole('button', { name });
      fireEvent.click(button);
      await waitFor(() => expect(button).toBeDisabled());
    }

    const refund = screen.getAllByRole('button', { name: /Refund & Delete/ })[0];
    fireEvent.click(refund);
    await waitFor(() => expect(refund).toBeDisabled());

    type('e.g. 500 or -100', '10');
    type('e.g. Compensation for missing quiz', 'r');
    submitFor('e.g. 500 or -100');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Apply Adjustment' })).toBeNull());

    type('Enter new strong password', 'longpassword');
    click('Force Change Password');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Force Change Password' })).toBeNull());

    type('e.g. Account Credited', 't');
    type('Your detailed message...', 'm');
    click('Dispatch Message');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Dispatch Message' })).toBeNull());

    type(/Add a private note/, 'n');
    const addNote = screen.getByRole('button', { name: /Add Note/ });
    fireEvent.click(addNote);
    await waitFor(() => expect(addNote).toBeDisabled());
  });
});
