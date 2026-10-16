import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import { resolveServerTree } from '@/tests/helpers/server-render';

const h = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() },
  params: new URLSearchParams(),
  suspend: false,
  routeParams: { id: 'z1' } as Record<string, string> | null,
  auth: { user: { id: 'u1' } as Record<string, unknown> | null, isLoading: false },
  requireAdminSession: vi.fn(),
  getUser: vi.fn(),
  stats: vi.fn(),
  activity: vi.fn(),
  media: { getCloudinaryUsage: vi.fn(), getCloudinaryResources: vi.fn(), deleteCloudinaryResource: vi.fn() },
  log: vi.fn(),
  dynamics: [] as { loader: () => Promise<unknown>; opts?: { loading?: () => React.ReactNode } }[],
}));
vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  useParams: () => h.routeParams,
  useSearchParams: () => { if (h.suspend) throw new Promise(() => {}); return h.params; },
  usePathname: () => '/admin',
  redirect: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/admin-session', () => ({ requireAdminSession: () => h.requireAdminSession() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: () => h.getUser() } }) }));
vi.mock('@/actions/dashboard-actions', () => ({ getDashboardStats: () => h.stats(), getRecentActivity: (n: number) => h.activity(n) }));
vi.mock('@/actions/media-actions', () => ({
  getCloudinaryUsage: () => h.media.getCloudinaryUsage(),
  getCloudinaryResources: () => h.media.getCloudinaryResources(),
  deleteCloudinaryResource: (id: string) => h.media.deleteCloudinaryResource(id),
}));
vi.mock('@/lib/logger', () => ({ default: { log: h.log } }));
// eslint-disable-next-line @next/next/no-img-element -- stand-in for CldImage
vi.mock('next-cloudinary', () => ({ CldImage: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('@/components/admin/DynamicAdminComponents', () => ({
  DynamicPlayerClaimsManager: () => <div>claims manager</div>,
  DynamicLiveStreamManager: () => <div>stream manager</div>,
  DynamicWalletTransactionsManager: () => <div>wallet manager</div>,
}));
vi.mock('@/components/admin/WalletFeatureToggle', () => ({ default: () => <div>wallet toggle</div> }));
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>, opts?: { loading?: () => React.ReactNode }) => {
    h.dynamics.push({ loader, opts });
    const name = String(loader).match(/admin\/([\w/]+)|components\/(\w+)/)?.slice(1).find(Boolean) ?? 'lazy';
    return (props: { onQuizChange?: (q: unknown) => void; onQuestionsChange?: (q: unknown[]) => void }) => (
      <div>
        {`lazy:${name}`}
        {props.onQuizChange && <button onClick={() => props.onQuizChange!({ id: 'z1', title: 'Renamed quiz' })}>rename quiz</button>}
        {props.onQuestionsChange && <button onClick={() => props.onQuestionsChange!([{}, {}])}>questions changed</button>}
      </div>
    );
  },
}));
for (const m of ['LuckyWinnerManager', 'QuizManagement', 'questions/QuestionManagement']) vi.doMock(`@/components/admin/${m}`, () => ({ default: () => null }));
vi.mock('@/components/QuizEvaluationManager', () => ({ default: () => null }));

import AdminDashboardPage from '@/app/admin/(protected)/dashboard/page';
import AdminClaimsPage from '@/app/admin/(protected)/claims/page';
import AdminStreamingPage from '@/app/admin/(protected)/streaming/page';
import AdminWalletPage from '@/app/admin/(protected)/wallet/page';
import MediaPage, { metadata as mediaMeta } from '@/app/admin/(protected)/media/page';
import LuckyWinnerPage from '@/app/admin/(protected)/lucky-winner/page';
import QuizEvaluationPage from '@/app/admin/(protected)/quiz-evaluation/page';
import AdminLogin from '@/app/admin/(public)/login/page';
import QuizManagementPage from '@/app/admin/(protected)/quiz/[id]/page';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  for (const f of [h.router.push, h.router.replace, h.log]) f.mockReset();
  h.params = new URLSearchParams();
  h.suspend = false;
  h.routeParams = { id: 'z1' };
  h.auth = { user: { id: 'u1' }, isLoading: false };
  h.requireAdminSession.mockReset().mockResolvedValue('boss@x.com');
  h.getUser.mockReset().mockResolvedValue({ data: { user: { user_metadata: { name: 'Admin Ali' } } } });
  h.stats.mockReset().mockResolvedValue({ totalUsers: 1200, recentUsers: 40, activeQuizzes: 3, totalQuizzes: 9, completionRate: 87, completedAttempts: 500, totalRevenue: 25000 });
  h.activity.mockReset().mockResolvedValue([]);
  fetchMock = vi.fn(async () => jsonResponse({ quizzes: [] }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('admin dashboard', () => {
  it('greets the admin and shows KPIs, activity and navigation', async () => {
    render(await resolveServerTree(await AdminDashboardPage()));
    expect(screen.getByText('Welcome back, Admin Ali')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('+40 this week')).toBeInTheDocument();
    expect(screen.getByText('PKR 25,000')).toBeInTheDocument();
    expect(screen.getByText('No recent activity')).toBeInTheDocument();
    expect(h.activity).toHaveBeenCalledWith(8);
    expect(screen.getAllByRole('link', { name: /Quiz Evaluation/ }).length).toBeGreaterThan(1);
  });

  it.each([
    [{ user_metadata: { full_name: 'Full Name' } }, 'Full Name'],
    [{ user_metadata: {}, email: 'ops@x.com' }, 'ops'],
    [null, 'boss'],
  ])('falls back through the admin name sources (%#)', async (user, name) => {
    h.getUser.mockResolvedValue({ data: { user } });
    render(await AdminDashboardPage());
    expect(screen.getByText(`Welcome back, ${name}`)).toBeInTheDocument();
  });

  it('calls the admin "Admin" when there is no name at all', async () => {
    h.requireAdminSession.mockResolvedValue('');
    h.getUser.mockResolvedValue({ data: { user: null } });
    render(await AdminDashboardPage());
    expect(screen.getByText('Welcome back, Admin')).toBeInTheDocument();
  });
});

describe('admin section pages', () => {
  it.each([
    [AdminClaimsPage, 'Prize Claims', 'claims manager'],
    [AdminStreamingPage, 'Live Streaming', 'stream manager'],
    [AdminWalletPage, 'Wallet Management', 'wallet manager'],
  ])('%o checks the session and renders its manager', async (Page, title, manager) => {
    render(await (Page as () => Promise<React.ReactElement>)());
    expect(h.requireAdminSession).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(manager)).toBeInTheDocument();
  });

  it('shows the wallet switch on the wallet page', async () => {
    render(await AdminWalletPage());
    expect(screen.getByText('wallet toggle')).toBeInTheDocument();
  });
});

describe('media management', () => {
  const usage = { storage: { usage: 5 * 1024 * 1024, limit: 25 * 1024 ** 3 }, bandwidth: { usage: 10 * 1024 * 1024, limit: 25 * 1024 ** 3 }, transformations: { usage: 12, limit: 25000 } };
  const resources = [{ public_id: 'prizes/watch', bytes: 2048, format: 'png' }, { public_id: 'prizes/bike', bytes: 4096, format: 'jpg' }];

  beforeEach(() => {
    h.media.getCloudinaryUsage.mockReset().mockResolvedValue({ success: true, usage });
    h.media.getCloudinaryResources.mockReset().mockResolvedValue({ success: true, resources: { resources } });
    h.media.deleteCloudinaryResource.mockReset().mockResolvedValue({ success: true });
  });

  it('shows usage and the asset gallery', async () => {
    render(<MediaPage />);
    expect(mediaMeta.title).toBe('Media Management | Admin Dashboard');
    expect(await screen.findByText('5.00 MB')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('PNG')).toBeInTheDocument();
  });

  it('shows an empty gallery when loading fails', async () => {
    h.media.getCloudinaryUsage.mockResolvedValue({ success: false });
    h.media.getCloudinaryResources.mockResolvedValue({ success: false });
    const { unmount } = render(<MediaPage />);
    expect(await screen.findByText('No media found in your Cloudinary account.')).toBeInTheDocument();
    expect(screen.queryByText('Storage Used')).toBeNull();
    unmount();
    h.media.getCloudinaryUsage.mockRejectedValue(new Error('cloudinary down'));
    render(<MediaPage />);
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to load media data', expect.any(Error)));
  });

  it('deletes an asset after confirmation, and reports failures', async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const alert = vi.fn();
    vi.stubGlobal('confirm', confirm);
    vi.stubGlobal('alert', alert);
    render(<MediaPage />);
    await screen.findByText('5.00 MB');
    const del = () => fireEvent.click(screen.getAllByTitle('Delete Image')[0]);
    del();
    expect(h.media.deleteCloudinaryResource).not.toHaveBeenCalled();
    h.media.deleteCloudinaryResource.mockResolvedValueOnce({ success: false, error: 'in use' }).mockRejectedValueOnce(new Error('x'));
    del();
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Failed to delete image: in use'));
    del();
    await waitFor(() => expect(alert).toHaveBeenCalledWith('An error occurred while deleting.'));
    del();
    await waitFor(() => expect(screen.queryByRole('img', { name: 'prizes/watch' })).toBeNull());
    expect(h.media.deleteCloudinaryResource).toHaveBeenLastCalledWith('prizes/watch');
  });

  it('shows a spinner on the asset being deleted', async () => {
    vi.stubGlobal('confirm', () => true);
    h.media.deleteCloudinaryResource.mockReturnValueOnce(new Promise(() => {}));
    render(<MediaPage />);
    await screen.findByText('5.00 MB');
    fireEvent.click(screen.getAllByTitle('Delete Image')[0]);
    await waitFor(() => expect(screen.getAllByTitle('Delete Image')[0]).toBeDisabled());
  });
});

describe('client-checked admin pages', () => {
  it('lucky winner: lets admins in and sends others to the admin login', async () => {
    const { unmount } = render(<LuckyWinnerPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(await screen.findByText('Lucky Winner Draw')).toBeInTheDocument();
    expect(screen.getByText(/lazy:/)).toBeInTheDocument();
    unmount();
    for (const response of [() => jsonResponse({}, 401), () => jsonResponse({}, 403), () => { throw new Error('x'); }]) {
      fetchMock.mockImplementationOnce(async () => response());
      const r = render(<LuckyWinnerPage />);
      await waitFor(() => expect(h.router.push).toHaveBeenLastCalledWith('/admin/login'));
      expect(screen.queryByText('Lucky Winner Draw')).toBeNull();
      r.unmount();
    }
  });

  it('quiz evaluation: lets admins in and sends others to the admin login', async () => {
    const { unmount } = render(<QuizEvaluationPage />);
    expect(await screen.findByText('Quiz Evaluation')).toBeInTheDocument();
    unmount();
    for (const response of [() => jsonResponse({}, 401), () => jsonResponse({}, 403), () => { throw new Error('x'); }]) {
      h.router.push.mockClear();
      fetchMock.mockImplementationOnce(async () => response());
      const r = render(<QuizEvaluationPage />);
      await waitFor(() => expect(h.router.push).toHaveBeenLastCalledWith('/admin/login'));
      expect(screen.queryByText('Quiz Evaluation')).toBeNull();
      r.unmount();
    }
    expect(h.router.push).not.toHaveBeenCalledWith('/login');
    expect(console.error).toHaveBeenCalledWith('Admin check failed:', expect.any(Error));
  });

  it('renders the lazy managers with their loading skeletons', async () => {
    for (const d of h.dynamics) {
      await expect(d.loader()).resolves.toBeTruthy();
      if (d.opts?.loading) {
        const { container, unmount } = render(<>{d.opts.loading()}</>);
        expect(container.querySelector('.animate-pulse')).not.toBeNull();
        unmount();
      }
    }
  });
});

describe('admin login', () => {
  const login = (email = 'boss@x.com', password = 'secret') => {
    fireEvent.change(screen.getByLabelText('Admin Email'), { target: { value: email } });
    fireEvent.change(screen.getByLabelText('Admin Password'), { target: { value: password } });
    fireEvent.submit(screen.getByRole('button', { name: /Access Admin Panel|Authenticating/ }).closest('form')!);
  };

  it('signs in and goes to the dashboard or the requested page', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
    const { unmount } = render(<AdminLogin />);
    login();
    await waitFor(() => expect(h.router.push).toHaveBeenCalledWith('/admin/dashboard'));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'boss@x.com', password: 'secret' });
    unmount();
    h.params = new URLSearchParams('redirect=/admin/prizes');
    render(<AdminLogin />);
    login();
    await waitFor(() => expect(h.router.push).toHaveBeenLastCalledWith('/admin/prizes'));
  });

  it('shows login failures and toggles the password', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Invalid credentials' }, 401)).mockResolvedValueOnce(jsonResponse({}, 500)).mockRejectedValueOnce(new Error('x'));
    render(<AdminLogin />);
    const pw = screen.getByLabelText('Admin Password');
    fireEvent.click(pw.parentElement!.querySelector('button')!);
    expect(pw).toHaveAttribute('type', 'text');
    fireEvent.click(pw.parentElement!.querySelector('button')!);
    login();
    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
    login();
    expect(await screen.findByText('Authentication failed')).toBeInTheDocument();
    login();
    expect(await screen.findByText('An error occurred. Please try again.')).toBeInTheDocument();
  });

  it('shows a busy button, and a fallback while suspended', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<AdminLogin />);
    login();
    expect(await screen.findByRole('button', { name: /Authenticating/ })).toBeDisabled();
    unmount();
    h.suspend = true;
    const { container } = render(<AdminLogin />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});

describe('admin quiz detail page', () => {
  it('loads the quiz, switches tabs and follows updates', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ quiz: { id: 'z1', title: 'Cricket Cup' } }));
    render(<QuizManagementPage />);
    expect(screen.getByText('Loading Quiz')).toBeInTheDocument();
    expect(await screen.findByText('Cricket Cup')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'rename quiz' }));
    expect(screen.getByText('Renamed quiz')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Question Management' }));
    fireEvent.click(await screen.findByRole('button', { name: 'questions changed' }));
    expect(h.log).toHaveBeenCalledWith('Questions updated:', 2);
  });

  it('reports load errors and retries', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ message: 'DB down' }, 500))
      .mockResolvedValueOnce(new Response('x', { status: 500 }))
      .mockRejectedValueOnce('odd')
      .mockResolvedValueOnce(jsonResponse({ quiz: null }));
    render(<QuizManagementPage />);
    expect(await screen.findByText('Quiz not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('DB down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('Failed to fetch quiz')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('An unknown error occurred')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go Back' }));
    expect(h.router.push).toHaveBeenCalledWith('/admin/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('Quiz Management', { selector: 'h1' })).toBeInTheDocument();
  });

  it('needs only the admin login: loads for an admin who is not signed in as a player', async () => {
    // The (protected) layout checks the admin session; the page must not ask for a player one
    h.auth = { user: null, isLoading: false };
    fetchMock.mockImplementation(async () => jsonResponse({ quiz: { id: 'z1', title: 'Cricket Cup' } }));
    render(<QuizManagementPage />);
    expect(await screen.findByText('Cricket Cup')).toBeInTheDocument();
    expect(h.router.push).not.toHaveBeenCalled();
  });

  it('does nothing without a quiz id', () => {
    h.routeParams = null;
    render(<QuizManagementPage />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
