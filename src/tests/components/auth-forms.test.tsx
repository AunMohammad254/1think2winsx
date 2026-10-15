import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  params: new URLSearchParams(),
  loginAction: vi.fn(),
  registerAction: vi.fn(),
  getGoogleOAuthUrl: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => h.params, usePathname: () => '/auth' }));
vi.mock('@/actions/auth-actions', () => ({
  loginAction: (...a: unknown[]) => h.loginAction(...a),
  registerAction: (...a: unknown[]) => h.registerAction(...a),
  getGoogleOAuthUrl: (...a: unknown[]) => h.getGoogleOAuthUrl(...a),
}));

import LoginForm from '@/components/auth/LoginForm';
import RegisterForm from '@/components/auth/RegisterForm';

let hrefSetter: ReturnType<typeof vi.fn<(v: string) => void>>;
const realLocation = window.location;
beforeEach(() => {
  h.params = new URLSearchParams();
  h.loginAction.mockReset();
  h.registerAction.mockReset();
  h.getGoogleOAuthUrl.mockReset();
  hrefSetter = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { set href(v: string) { hrefSetter(v); }, get href() { return 'http://localhost/auth'; } } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.useRealTimers();
});

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('LoginForm', () => {
  it('validates the fields before calling the server', async () => {
    render(<LoginForm onSwitchToRegister={vi.fn()} />);
    type('Email Address', 'nope');
    // jsdom runs native constraint validation on button clicks, which would block an invalid email
    fireEvent.submit(screen.getByRole('button', { name: /Sign In/ }).closest('form')!);
    expect(await screen.findByText('Invalid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(h.loginAction).not.toHaveBeenCalled();
  });

  it('signs in and follows the redirect with a full page load', async () => {
    h.loginAction.mockResolvedValueOnce({ success: true, redirectTo: '/quizzes' }).mockResolvedValueOnce({ success: true });
    render(<LoginForm onSwitchToRegister={vi.fn()} />);
    type('Email Address', 'ali@example.com');
    type('Password', 'secret');
    fireEvent.click(screen.getByRole('button', { name: /Sign In/ }));
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('/quizzes'));
    expect(h.loginAction).toHaveBeenCalledWith({ email: 'ali@example.com', password: 'secret' });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/ }));
    await waitFor(() => expect(h.loginAction).toHaveBeenCalledTimes(2));
    expect(hrefSetter).toHaveBeenCalledTimes(1);
  });

  it('shows server errors and a generic one when the call throws', async () => {
    h.loginAction.mockResolvedValueOnce({ success: false, error: 'Wrong password' }).mockResolvedValueOnce({ success: false }).mockRejectedValueOnce(new Error('x'));
    render(<LoginForm onSwitchToRegister={vi.fn()} />);
    type('Email Address', 'ali@example.com');
    type('Password', 'secret');
    const submit = () => fireEvent.click(screen.getByRole('button', { name: /Sign In/ }));
    submit();
    expect(await screen.findByText('Wrong password')).toBeInTheDocument();
    submit();
    expect(await screen.findByText('Login failed')).toBeInTheDocument();
    submit();
    expect(await screen.findByText('An error occurred during login')).toBeInTheDocument();
  });

  it('starts Google sign-in, and reports when it cannot', async () => {
    h.getGoogleOAuthUrl.mockResolvedValueOnce('https://accounts.google.com/o').mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('x'));
    render(<LoginForm onSwitchToRegister={vi.fn()} />);
    const google = () => screen.getByRole('button', { name: /Continue with Google|Signing in/ });
    fireEvent.click(google());
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('https://accounts.google.com/o'));
    expect(h.getGoogleOAuthUrl).toHaveBeenCalledWith('/quizzes');
    expect(google()).toHaveTextContent('Signing in...');
  });

  it('reports a Google sign-in that fails to start', async () => {
    h.getGoogleOAuthUrl.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('x'));
    render(<LoginForm onSwitchToRegister={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    expect(await screen.findByText('Failed to initiate Google sign-in')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    expect(await screen.findByText('An error occurred during Google sign-in')).toBeInTheDocument();
  });

  it('shows messages carried in the URL and toggles password visibility', () => {
    h.params = new URLSearchParams('registered=true&error=auth_callback_error');
    const onSwitch = vi.fn();
    const { unmount } = render(<LoginForm onSwitchToRegister={onSwitch} />);
    expect(screen.getByText(/Almost there! Check your email/)).toBeInTheDocument();
    expect(screen.getByText(/That sign-in link did not work/)).toBeInTheDocument();
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(pw.parentElement!.querySelector('button')!);
    expect(pw).toHaveAttribute('type', 'text');
    fireEvent.click(pw.parentElement!.querySelector('button')!);
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Create one now' }));
    expect(onSwitch).toHaveBeenCalled();
    unmount();

    h.params = new URLSearchParams('password_reset=success');
    render(<LoginForm onSwitchToRegister={onSwitch} />);
    expect(screen.getByText('Password updated successfully! Please log in with your new password.')).toBeInTheDocument();
  });
});

describe('RegisterForm', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 16));
  });

  const fillValid = () => {
    type('Full Name', 'Ali Raza');
    type('Email Address', 'Ali@Example.com');
    type('Phone (Optional)', '03123456789');
    type('Password', 'Str0ng!pass');
    type('Confirm Password', 'Str0ng!pass');
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    fireEvent.click(screen.getByLabelText('Date of Birth'));
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === '15')!); // Oct 15, 2008
  };
  const submit = () => fireEvent.submit(screen.getByRole('button', { name: /Create Account/ }).closest('form')!);

  it('shows every validation message', async () => {
    render(<RegisterForm onSwitchToLogin={vi.fn()} />);
    type('Full Name', 'A1');
    type('Email Address', 'bad');
    type('Phone (Optional)', '123');
    type('Password', 'weak');
    type('Confirm Password', 'other');
    submit();
    expect(await screen.findByText('Name can only contain letters and spaces')).toBeInTheDocument();
    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Please enter a valid phone number (e.g., 03123456789)')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('You must agree to the terms')).toBeInTheDocument();
    expect(h.registerAction).not.toHaveBeenCalled();
  });

  it('rates password strength as you type', () => {
    render(<RegisterForm onSwitchToLogin={vi.fn()} />);
    type('Password', 'a');
    expect(screen.getByText('Very Weak')).toBeInTheDocument();
    type('Password', 'aB1');
    expect(screen.getByText('Fair')).toBeInTheDocument();
    type('Password', 'aB1!aaaa');
    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(screen.getByText('Special char').parentElement!.className).toContain('text-green-400');
    const pw = screen.getByLabelText('Password');
    fireEvent.click(pw.parentElement!.querySelector('button')!);
    expect(pw).toHaveAttribute('type', 'text');
    fireEvent.click(pw.parentElement!.querySelector('button')!);
    expect(pw).toHaveAttribute('type', 'password');
  });

  it('creates the account and switches to sign-in after two seconds', async () => {
    h.registerAction.mockResolvedValue({ success: true });
    const onSwitch = vi.fn();
    const timers = vi.spyOn(window, 'setTimeout');
    render(<RegisterForm onSwitchToLogin={onSwitch} />);
    fillValid();
    submit();
    expect(await screen.findByText('Account created! Please check your email to verify your account.')).toBeInTheDocument();
    expect(h.registerAction).toHaveBeenCalledWith({ name: 'Ali Raza', email: 'ali@example.com', password: 'Str0ng!pass', phone: '03123456789', dateOfBirth: '2008-10-15' });
    const call = timers.mock.calls.find(([, ms]) => ms === 2000)!;
    (call[0] as () => void)();
    expect(onSwitch).toHaveBeenCalled();
  });

  it('sends no phone when left empty, and shows server errors', async () => {
    h.registerAction.mockResolvedValueOnce({ success: false, error: 'Email already registered' }).mockResolvedValueOnce({ success: false }).mockRejectedValueOnce(new Error('x'));
    render(<RegisterForm onSwitchToLogin={vi.fn()} />);
    fillValid();
    type('Phone (Optional)', '');
    submit();
    expect(await screen.findByText('Email already registered')).toBeInTheDocument();
    expect(h.registerAction.mock.calls[0][0].phone).toBeUndefined();
    submit();
    expect(await screen.findByText('Registration failed')).toBeInTheDocument();
    submit();
    expect(await screen.findByText('An error occurred during registration')).toBeInTheDocument();
  });

  it('lets the date of birth be cleared, sending none', async () => {
    render(<RegisterForm onSwitchToLogin={vi.fn()} />);
    fillValid();
    // clear the date: the picker's Clear button sets an empty string, which the schema allows
    fireEvent.click(screen.getByLabelText('Date of Birth'));
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
    submit();
    await waitFor(() => expect(h.registerAction).toHaveBeenCalledWith(expect.objectContaining({ dateOfBirth: undefined })));
  });

  it('starts Google sign-in and switches to the login form', async () => {
    h.getGoogleOAuthUrl.mockResolvedValueOnce('https://g').mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('x'));
    const onSwitch = vi.fn();
    render(<RegisterForm onSwitchToLogin={onSwitch} />);
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('https://g'));
    expect(screen.getByRole('button', { name: /Signing in/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSwitch).toHaveBeenCalled();
  });

  it('reports a Google sign-in that fails to start', async () => {
    h.getGoogleOAuthUrl.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('x'));
    render(<RegisterForm onSwitchToLogin={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    expect(await screen.findByText('Failed to initiate Google sign-in')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    expect(await screen.findByText('An error occurred during Google sign-in')).toBeInTheDocument();
  });
});
