import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({
  redirect: vi.fn(),
  validateAdminSession: vi.fn(),
  captureException: vi.fn(),
  dynamics: [] as { loader: () => Promise<unknown>; opts?: { loading?: () => React.ReactNode } }[],
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => h.redirect(url),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>, opts?: { loading?: () => React.ReactNode }) => {
    h.dynamics.push({ loader, opts });
    return function Lazy() { return <div data-testid="lazy" />; };
  },
}));
// The real stylesheet goes through the Tailwind PostCSS plugin, which the test runner cannot load.
vi.mock('@/app/globals.css', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: (...a: unknown[]) => h.captureException(...a) }));
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-geist' }),
  Poppins: () => ({ variable: 'font-poppins' }),
}));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: () => h.validateAdminSession() }));
vi.mock('@/contexts/AuthContext', () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="auth">{children}</div>, useAuth: () => ({ user: null, isLoading: false }) }));
vi.mock('@/contexts/ProfileContext', () => ({ ProfileProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="profile">{children}</div> }));
vi.mock('@/contexts/PWAContext', () => ({ PWAProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="pwa">{children}</div> }));
vi.mock('@/components/Navbar', () => ({ default: () => <nav>navbar</nav> }));
vi.mock('@/components/analytics/WebVitals', () => ({ WebVitals: () => null }));
vi.mock('@/components/landing/Hero', () => ({ default: () => <section>hero</section> }));
vi.mock('@/components/landing/ScrollProgress', () => ({ default: () => null }));
vi.mock('@/components/landing/SectionNav', () => ({ default: () => null }));

import RootLayout, { metadata } from '@/app/layout';
import { Providers } from '@/app/providers';
import Home from '@/app/page';
import LoginPage from '@/app/login/page';
import RegisterPage from '@/app/register/page';
import AdminLayout from '@/app/admin/layout';
import AdminLoginLayout from '@/app/admin/(public)/layout';
import AdminProtectedLayout from '@/app/admin/(protected)/layout';
import PrizesLoading from '@/app/prizes/loading';
import QuizzesLoading from '@/app/quizzes/loading';
import QuizLoading from '@/app/quiz/[id]/loading';
import DashboardLoading from '@/app/admin/(protected)/dashboard/loading';
import PrizesError from '@/app/prizes/error';
import QuizzesError from '@/app/quizzes/error';
import QuizError from '@/app/quiz/[id]/error';

beforeEach(() => {
  h.redirect.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('root layout and providers', () => {
  it('wraps every page with providers, navbar, footer and the chatbot', () => {
    const html = renderToStaticMarkup(<RootLayout><p>page body</p></RootLayout>);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('font-geist font-poppins');
    expect(html).toContain('navbar');
    expect(html).toContain('page body');
    expect(html).toContain('href="https://res.cloudinary.com"');
    expect(metadata.title).toBe('1Think 2Win');
  });

  it('nests the auth, profile and PWA providers', () => {
    render(<Providers><span>inside</span></Providers>);
    expect(screen.getByTestId('auth').querySelector('[data-testid="profile"] [data-testid="pwa"]')).toHaveTextContent('inside');
  });

  it('lazy-loads each heavy section with a placeholder', async () => {
    render(<Home />);
    expect(screen.getByText('hero')).toBeInTheDocument();
    expect(document.getElementById('stats')).not.toBeNull();
    for (const d of h.dynamics) {
      await expect(d.loader()).resolves.toBeTruthy();
      if (d.opts?.loading) render(<>{d.opts.loading()}</>);
    }
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});

describe('redirects and layouts', () => {
  it('sends /login and /register to the combined auth page', () => {
    LoginPage();
    RegisterPage();
    expect(h.redirect.mock.calls).toEqual([['/auth?mode=login'], ['/auth?mode=register']]);
  });

  it('passes admin pages through, and guards the protected ones', async () => {
    render(<AdminLayout><AdminLoginLayout><p>login form</p></AdminLoginLayout></AdminLayout>);
    expect(screen.getByText('login form')).toBeInTheDocument();
    h.validateAdminSession.mockResolvedValueOnce({ valid: true });
    render(await AdminProtectedLayout({ children: <p>dashboard</p> }));
    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(h.redirect).not.toHaveBeenCalled();
    h.validateAdminSession.mockResolvedValueOnce({ valid: false });
    await AdminProtectedLayout({ children: <p>secret</p> });
    expect(h.redirect).toHaveBeenCalledWith('/admin/login');
  });
});

describe('loading skeletons', () => {
  it.each([
    ['prizes', PrizesLoading],
    ['quizzes', QuizzesLoading],
    ['quiz', QuizLoading],
    ['admin dashboard', DashboardLoading],
  ])('%s renders a pulsing placeholder', (_name, Loading) => {
    const { container } = render(<Loading />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});

describe('error boundaries', () => {
  it('reports each caught error to Sentry, tagged with its page (the global handler never sees it)', () => {
    h.captureException.mockReset();
    const error = new Error('boom');
    render(<PrizesError error={error} reset={vi.fn()} />);
    render(<QuizzesError error={error} reset={vi.fn()} />);
    render(<QuizError error={error} reset={vi.fn()} />);
    expect(h.captureException.mock.calls).toEqual([
      [error, { tags: { page: 'prizes' } }],
      [error, { tags: { page: 'quizzes' } }],
      [error, { tags: { page: 'quiz' } }],
    ]);
  });

  it('prizes: reports the error, retries, and shows the digest', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    const { rerender } = render(<PrizesError error={error} reset={reset} />);
    expect(h.captureException).toHaveBeenCalledWith(error, { tags: { page: 'prizes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByText('Error ID: abc123')).toBeInTheDocument();
    rerender(<PrizesError error={new Error('x')} reset={reset} />);
    expect(screen.queryByText(/Error ID/)).toBeNull();
  });

  it('quizzes: shows details only in development', () => {
    const reset = vi.fn();
    const { rerender } = render(<QuizzesError error={new Error('db down')} reset={reset} />);
    expect(screen.queryByText('db down')).toBeNull();
    vi.stubEnv('NODE_ENV', 'development');
    rerender(<QuizzesError error={Object.assign(new Error('db down'), { digest: 'd1' })} reset={reset} />);
    expect(screen.getByText('db down')).toBeInTheDocument();
    expect(screen.getByText('Error ID: d1')).toBeInTheDocument();
    rerender(<QuizzesError error={new Error('no digest')} reset={reset} />);
    expect(screen.queryByText(/Error ID/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Try Again/ }));
    expect(reset).toHaveBeenCalled();
  });

  it('quiz: tailors the message to access, not-found and other errors', () => {
    const reset = vi.fn();
    const { rerender } = render(<QuizError error={new Error('Payment required for access')} reset={reset} />);
    expect(screen.getByText('Quiz Access Required')).toBeInTheDocument();
    rerender(<QuizError error={new Error('You need to pay')} reset={reset} />);
    expect(screen.getByText('Quiz Access Required')).toBeInTheDocument();
    rerender(<QuizError error={new Error('Quiz not found')} reset={reset} />);
    expect(screen.getByText('Quiz Not Found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try Again/ })).toBeNull();
    vi.stubEnv('NODE_ENV', 'development');
    rerender(<QuizError error={new Error('Timeout')} reset={reset} />);
    expect(screen.getByText('Quiz Error')).toBeInTheDocument();
    expect(screen.getByText('Timeout')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try Again/ }));
    expect(reset).toHaveBeenCalled();
    rerender(<QuizError error={{ name: 'E' } as Error} reset={reset} />);
    expect(screen.getByText('Quiz Error')).toBeInTheDocument();
  });
});
