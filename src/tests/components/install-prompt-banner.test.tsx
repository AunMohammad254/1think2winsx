import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InstallPromptBanner from '@/components/InstallPromptBanner';
import { usePWA } from '@/contexts/PWAContext';
import logger from '@/lib/logger';

vi.mock('@/contexts/PWAContext', () => ({
  usePWA: vi.fn(),
}));

vi.mock('@/components/brand/Logo', () => ({
  default: () => <div data-testid="brand-logo">Logo</div>,
}));

vi.mock('@/lib/logger', () => ({
  default: {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('InstallPromptBanner', () => {
  const mockInstallApp = vi.fn();
  const mockDismissBanner = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when not installable', () => {
    vi.mocked(usePWA).mockReturnValue({
      isInstallable: false,
      isBannerDismissed: false,
      installApp: mockInstallApp,
      dismissBanner: mockDismissBanner,
      deferredPrompt: null,
      isInstalled: false,
    });

    const { container } = render(<InstallPromptBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when banner is dismissed', () => {
    vi.mocked(usePWA).mockReturnValue({
      isInstallable: true,
      isBannerDismissed: true,
      installApp: mockInstallApp,
      dismissBanner: mockDismissBanner,
      deferredPrompt: null,
      isInstalled: false,
    });

    const { container } = render(<InstallPromptBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the banner when installable and not dismissed', () => {
    vi.mocked(usePWA).mockReturnValue({
      isInstallable: true,
      isBannerDismissed: false,
      installApp: mockInstallApp,
      dismissBanner: mockDismissBanner,
      deferredPrompt: null,
      isInstalled: false,
    });

    render(<InstallPromptBanner />);
    expect(screen.getByText('Install 1Think2Win App')).toBeInTheDocument();
    expect(screen.getByText(/Get active sports quizzes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Install Now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Later/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dismiss banner/i })).toBeInTheDocument();
  });

  it('calls installApp and logs outcome when Install Now is clicked', async () => {
    mockInstallApp.mockResolvedValue('accepted');
    vi.mocked(usePWA).mockReturnValue({
      isInstallable: true,
      isBannerDismissed: false,
      installApp: mockInstallApp,
      dismissBanner: mockDismissBanner,
      deferredPrompt: null,
      isInstalled: false,
    });

    render(<InstallPromptBanner />);

    const installButton = screen.getByRole('button', { name: /Install Now/i });
    fireEvent.click(installButton);

    expect(mockInstallApp).toHaveBeenCalledTimes(1);

    // We need to wait a tick for the async handleInstallClick to finish
    await new Promise(process.nextTick);

    expect(logger.log).toHaveBeenCalledWith('PWA installation outcome: accepted');
  });

  it('calls dismissBanner when Later is clicked', () => {
    vi.mocked(usePWA).mockReturnValue({
      isInstallable: true,
      isBannerDismissed: false,
      installApp: mockInstallApp,
      dismissBanner: mockDismissBanner,
      deferredPrompt: null,
      isInstalled: false,
    });

    render(<InstallPromptBanner />);

    const laterButton = screen.getByRole('button', { name: /Later/i });
    fireEvent.click(laterButton);

    expect(mockDismissBanner).toHaveBeenCalledTimes(1);
  });

  it('calls dismissBanner when X button is clicked', () => {
    vi.mocked(usePWA).mockReturnValue({
      isInstallable: true,
      isBannerDismissed: false,
      installApp: mockInstallApp,
      dismissBanner: mockDismissBanner,
      deferredPrompt: null,
      isInstalled: false,
    });

    render(<InstallPromptBanner />);

    const dismissButton = screen.getByRole('button', { name: /Dismiss banner/i });
    fireEvent.click(dismissButton);

    expect(mockDismissBanner).toHaveBeenCalledTimes(1);
  });
});
