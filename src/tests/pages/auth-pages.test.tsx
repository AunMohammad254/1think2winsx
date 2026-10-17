import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  router: { push: vi.fn() },
  params: new URLSearchParams(),
  suspend: false,
  verifyUnsubscribeToken: vi.fn(),
  resetPassword: vi.fn(),
  lookupEmailByPhone: vi.fn(),
  sendEmailReminder: vi.fn(),
  updatePassword: vi.fn(),
  auth: { getSession: vi.fn(), signOut: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/',
  useSearchParams: () => {
    if (h.suspend) throw new Promise(() => {});
    return h.params;
  },
}));
vi.mock('@/lib/newsletter-unsubscribe', () => ({ verifyUnsubscribeToken: (...a: unknown[]) => h.verifyUnsubscribeToken(...a) }));
vi.mock('@/app/forgot-password/actions', () => ({ resetPassword: (...a: unknown[]) => h.resetPassword(...a) }));
vi.mock('@/components/auth/TurnstileWidget', async () => ({ default: (await import('@/tests/helpers/turnstile-mock')).TurnstileMock }));
vi.mock('@/app/forgot-email/actions', () => ({
  lookupEmailByPhone: (...a: unknown[]) => h.lookupEmailByPhone(...a),
  sendEmailReminder: (...a: unknown[]) => h.sendEmailReminder(...a),
}));
vi.mock('@/app/update-password/actions', () => ({ updatePassword: (...a: unknown[]) => h.updatePassword(...a) }));
const supabaseClient = { auth: h.auth };
vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabaseClient }));
vi.mock('@/components/auth/LoginForm', () => ({ default: ({ onSwitchToRegister }: { onSwitchToRegister: () => void }) => <div>login form<button onClick={onSwitchToRegister}>to register</button></div> }));
vi.mock('@/components/auth/RegisterForm', () => ({ default: ({ onSwitchToLogin }: { onSwitchToLogin: () => void }) => <div>register form<button onClick={onSwitchToLogin}>to login</button></div> }));

import UnsubscribePage, { metadata as unsubscribeMeta } from '@/app/unsubscribe/page';
import UnsubscribeButton from '@/app/unsubscribe/UnsubscribeButton';
import AuthPage from '@/app/auth/page';
import ForgotPasswordPage from '@/app/forgot-password/page';
import ForgotPasswordForm from '@/app/forgot-password/ForgotPasswordForm';
import ForgotEmailPage from '@/app/forgot-email/page';
import UpdatePasswordPage from '@/app/update-password/page';
import ClearAuthPage from '@/app/auth/clear/page';

beforeEach(() => {
  h.router.push.mockReset();
  h.params = new URLSearchParams();
  h.suspend = false;
  for (const f of [h.verifyUnsubscribeToken, h.resetPassword, h.lookupEmailByPhone, h.sendEmailReminder, h.updatePassword, h.auth.getSession, h.auth.signOut]) f.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const submitForm = (button: RegExp) => fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);

describe('unsubscribe page', () => {
  const page = async (e?: string, t?: string) => render(await UnsubscribePage({ searchParams: Promise.resolve({ e, t }) }));

  it('asks to confirm when the link is valid', async () => {
    h.verifyUnsubscribeToken.mockReturnValue(true);
    await page('ali@x.com', 'tok');
    expect(h.verifyUnsubscribeToken).toHaveBeenCalledWith('ali@x.com', 'tok');
    expect(screen.getByText('ali@x.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeInTheDocument();
    expect(unsubscribeMeta.robots).toEqual({ index: false, follow: false });
  });

  it('explains an invalid or broken link', async () => {
    h.verifyUnsubscribeToken.mockReturnValue(false);
    await page();
    expect(h.verifyUnsubscribeToken).toHaveBeenCalledWith('', '');
    expect(screen.getByText(/This unsubscribe link is invalid or incomplete/)).toBeInTheDocument();
    h.verifyUnsubscribeToken.mockImplementation(() => { throw new Error('bad secret'); });
    await page('a', 'b');
    expect(console.error).toHaveBeenCalledWith('Unsubscribe token check failed:', expect.any(Error));
  });

  it('unsubscribes, and reports refusals and network failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, message: 'Link expired' }, 400))
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ success: false }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(<UnsubscribeButton email="ali@x.com" token="tok" />);
    const click = () => fireEvent.click(screen.getByRole('button', { name: /Unsubscrib/ }));
    click();
    expect(await screen.findByText('Link expired')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ e: 'ali@x.com', t: 'tok' });
    click();
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    click();
    await waitFor(() => expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull());
    click();
    expect(await screen.findByText('Network error. Please try again.')).toBeInTheDocument();
    click();
    expect(await screen.findByText('You have been unsubscribed.')).toBeInTheDocument();
  });

  it('shows the server confirmation, and a busy state', async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (release = r))));
    render(<UnsubscribeButton email="a" token="b" />);
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(await screen.findByRole('button', { name: 'Unsubscribing…' })).toBeDisabled();
    await act(async () => release(jsonResponse({ success: true, message: 'Done, bye!' })));
    expect(screen.getByText('Done, bye!')).toBeInTheDocument();
  });
});

describe('auth page', () => {
  it('starts on sign-in and switches between forms', async () => {
    render(<AuthPage />);
    expect(screen.getByText('login form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
    expect(await screen.findByText('register form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'to login' }));
    expect(await screen.findByText('login form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'to register' }));
    expect(await screen.findByText('register form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('login form')).toBeInTheDocument();
  });

  it('opens on sign-up for ?mode=register, with a loading fallback while suspended', async () => {
    h.params = new URLSearchParams('mode=register');
    const { unmount } = render(<AuthPage />);
    expect(screen.getByText('register form')).toBeInTheDocument();
    unmount();
    h.suspend = true;
    render(<AuthPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});

describe('forgot password', () => {
  it('explains an expired link when sent back from the callback', async () => {
    render(await ForgotPasswordPage({ searchParams: Promise.resolve({ error: 'link_expired' }) }));
    expect(screen.getByText(/That link has expired or was already used/)).toBeInTheDocument();
    render(await ForgotPasswordPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText(/That link has expired/)).toHaveLength(1);
  });

  it('validates, sends the reset link and confirms', async () => {
    h.resetPassword.mockResolvedValueOnce({ success: true, message: 'If an account exists, check your inbox.' });
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'nope' } });
    submitForm(/Send Reset Link/);
    expect(await screen.findByText('Please enter a valid email address')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'ali@x.com' } });
    submitForm(/Send Reset Link/);
    expect(await screen.findByText('If an account exists, check your inbox.')).toBeInTheDocument();
    expect((h.resetPassword.mock.calls[0][0] as FormData).get('email')).toBe('ali@x.com');
    expect((h.resetPassword.mock.calls[0][0] as FormData).get('captchaToken')).toBe('captcha-token');
  });

  it('keeps Send Reset Link disabled until the security check passes, and replaces a used token', async () => {
    const { turnstile } = await import('@/tests/helpers/turnstile-mock');
    turnstile.token = null;
    const { unmount } = render(<ForgotPasswordForm />);
    expect(screen.getByTestId('turnstile-password_reset')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Reset Link/ })).toBeDisabled();
    unmount();

    turnstile.token = 'captcha-token';
    turnstile.resets = 0;
    h.resetPassword.mockResolvedValueOnce({ error: 'The security check failed or expired. Please try again.' });
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'ali@x.com' } });
    submitForm(/Send Reset Link/);
    expect(await screen.findByText('The security check failed or expired. Please try again.')).toBeInTheDocument();
    expect(turnstile.resets).toBe(1);
  });

  it('shows errors and a default confirmation', async () => {
    h.resetPassword.mockResolvedValueOnce({ error: 'Too many requests' }).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ success: true });
    render(<ForgotPasswordForm linkExpired />);
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'ali@x.com' } });
    submitForm(/Send Reset Link/);
    expect(await screen.findByText('Too many requests')).toBeInTheDocument();
    submitForm(/Send Reset Link/);
    expect(await screen.findByText('An error occurred. Please try again.')).toBeInTheDocument();
    submitForm(/Send Reset Link/);
    expect(await screen.findByText('Password reset link sent!')).toBeInTheDocument();
  });

  it('shows a busy button while sending', async () => {
    h.resetPassword.mockReturnValueOnce(new Promise(() => {}));
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'ali@x.com' } });
    submitForm(/Send Reset Link/);
    expect(await screen.findByRole('button', { name: /Sending/ })).toBeDisabled();
  });
});

describe('forgot email', () => {
  const lookup = (phone: string) => {
    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: phone } });
    submitForm(/Find My Email|Searching/);
  };

  it('validates the phone number and finds the masked email', async () => {
    h.lookupEmailByPhone.mockResolvedValueOnce({ success: true, maskedEmail: 'a***i@x.com' });
    render(<ForgotEmailPage />);
    lookup('123');
    expect(await screen.findByText(/Please enter a valid phone number/)).toBeInTheDocument();
    lookup('03123456789');
    expect(await screen.findByText('Account Found!')).toBeInTheDocument();
    expect(screen.getByText('a***i@x.com')).toBeInTheDocument();
  });

  it('reports lookup failures, and ignores an answer without an email', async () => {
    h.lookupEmailByPhone.mockResolvedValueOnce({ error: 'No account found' }).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ success: true });
    render(<ForgotEmailPage />);
    lookup('03123456789');
    expect(await screen.findByText('No account found')).toBeInTheDocument();
    lookup('03123456789');
    expect(await screen.findByText('An error occurred. Please try again.')).toBeInTheDocument();
    lookup('03123456789');
    await waitFor(() => expect(h.lookupEmailByPhone).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('Account Found!')).toBeNull();
  });

  it('emails a reminder, reporting failures, and can start over', async () => {
    h.lookupEmailByPhone.mockResolvedValue({ success: true, maskedEmail: 'a***i@x.com' });
    h.sendEmailReminder.mockResolvedValueOnce({ error: 'Already sent recently' }).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ success: true });
    render(<ForgotEmailPage />);
    lookup('+923123456789');
    await screen.findByText('Account Found!');
    const remind = () => fireEvent.click(screen.getByRole('button', { name: /Email me a reminder/ }));
    remind();
    expect(await screen.findByText('Already sent recently')).toBeInTheDocument();
    expect((h.sendEmailReminder.mock.calls[0][0] as FormData).get('phone')).toBe('+923123456789');
    remind();
    expect(await screen.findByText('An error occurred. Please try again.')).toBeInTheDocument();
    remind();
    expect(await screen.findByText(/We sent a reminder to/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search Another Number' }));
    expect(screen.getByLabelText('Phone Number')).toHaveValue('');
  });

  it('shows busy states while searching and sending', async () => {
    h.lookupEmailByPhone.mockResolvedValueOnce({ success: true, maskedEmail: 'm' }).mockReturnValueOnce(new Promise(() => {}));
    h.sendEmailReminder.mockReturnValueOnce(new Promise(() => {}));
    render(<ForgotEmailPage />);
    lookup('03123456789');
    await screen.findByText('Account Found!');
    fireEvent.click(screen.getByRole('button', { name: /Email me a reminder/ }));
    expect(await screen.findByRole('button', { name: /Sending/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Search Another Number' }));
    lookup('03123456789');
    expect(await screen.findByRole('button', { name: /Searching/ })).toBeDisabled();
  });
});

describe('update password', () => {
  const type = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });

  it('rejects visitors without a reset session', async () => {
    h.auth.getSession.mockResolvedValue({ data: { session: null } });
    render(<UpdatePasswordPage />);
    expect(await screen.findByText('Invalid or Expired Link')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request New Link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('sets the new password and moves on to the quizzes', async () => {
    h.auth.getSession.mockResolvedValue({ data: { session: { user: {} } } });
    h.updatePassword.mockResolvedValueOnce({ error: 'Must differ from the old one' }).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ success: true });
    const timers = vi.spyOn(window, 'setTimeout');
    render(<UpdatePasswordPage />);
    await screen.findByText('Set New Password');
    submitForm(/Update Password/);
    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    type('New Password', '___'); // underscores meet none of the five checks
    expect(screen.getByText('Very Weak')).toBeInTheDocument();
    expect(screen.getByText('Very Weak').previousElementSibling!.firstElementChild).toHaveClass('bg-slate-600');
    type('New Password', 'abC'); // lower + upper = 2 of 5
    expect(screen.getByText('Weak')).toBeInTheDocument();
    type('New Password', 'Str0ng!pass');
    expect(screen.getByText('Strong')).toBeInTheDocument();
    type('Confirm Password', 'different');
    submitForm(/Update Password/);
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    type('Confirm Password', 'Str0ng!pass');
    submitForm(/Update Password/);
    expect(await screen.findByText('Must differ from the old one')).toBeInTheDocument();
    submitForm(/Update Password/);
    expect(await screen.findByText('An error occurred. Please try again.')).toBeInTheDocument();
    submitForm(/Update Password/);
    expect(await screen.findByText('Password Updated!')).toBeInTheDocument();
    (timers.mock.calls.find(([, ms]) => ms === 2000)![0] as () => void)();
    expect(h.router.push).toHaveBeenCalledWith('/quizzes');
  });

  it('reveals the passwords and shows a busy button', async () => {
    h.auth.getSession.mockResolvedValue({ data: { session: { user: {} } } });
    h.updatePassword.mockReturnValueOnce(new Promise(() => {}));
    render(<UpdatePasswordPage />);
    await screen.findByText('Set New Password');
    for (const label of ['New Password', 'Confirm Password']) {
      const input = screen.getByLabelText(label);
      fireEvent.click(input.parentElement!.querySelector('button')!);
      expect(input).toHaveAttribute('type', 'text');
      fireEvent.click(input.parentElement!.querySelector('button')!);
    }
    type('New Password', 'Str0ng!pass');
    type('Confirm Password', 'Str0ng!pass');
    submitForm(/Update Password/);
    expect(await screen.findByRole('button', { name: /Updating/ })).toBeDisabled();
  });
});

describe('clear session page', () => {
  it('signs out everywhere and removes Supabase cookies and storage', async () => {
    h.auth.signOut.mockResolvedValue({});
    document.cookie = 'sb-access-token=abc; path=/';
    document.cookie = 'my-supabase-auth=1; path=/';
    document.cookie = 'theme=dark; path=/';
    localStorage.setItem('sb-project-auth-token', 'x');
    localStorage.setItem('keep-me', 'y');
    sessionStorage.setItem('supabase.session', 'z');
    sessionStorage.setItem('other', 'w');
    const timers = vi.spyOn(window, 'setTimeout');
    render(<ClearAuthPage />);
    expect(screen.getByText('Clearing Session')).toBeInTheDocument();
    expect(await screen.findByText('Session Cleared')).toBeInTheDocument();
    expect(h.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(document.cookie).not.toContain('sb-access-token');
    expect(document.cookie).not.toContain('my-supabase-auth');
    expect(document.cookie).toContain('theme=dark');
    expect(localStorage.getItem('sb-project-auth-token')).toBeNull();
    expect(localStorage.getItem('keep-me')).toBe('y');
    expect(sessionStorage.getItem('supabase.session')).toBeNull();
    expect(sessionStorage.getItem('other')).toBe('w');
    (timers.mock.calls.find(([, ms]) => ms === 2000)![0] as () => void)();
    expect(h.router.push).toHaveBeenCalledWith('/login');
    localStorage.clear();
    sessionStorage.clear();
  });

  it('explains how to clear cookies by hand when sign-out fails', async () => {
    h.auth.signOut.mockRejectedValue(new Error('network'));
    render(<ClearAuthPage />);
    expect(await screen.findByText('Clear Failed')).toBeInTheDocument();
    expect(screen.getByText('Manual steps to clear cookies:')).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith('Error clearing session:', expect.any(Error));
  });
});
