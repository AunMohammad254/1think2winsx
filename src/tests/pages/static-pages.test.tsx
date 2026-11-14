import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import { OPEN_CHATBOT_EVENT } from '@/components/chatbot/open-chatbot';

import PrivacyPolicy from '@/app/privacy/page';
import TermsOfService from '@/app/terms/page';
import DisclaimerPage from '@/app/disclaimer/page';
import ContactPage from '@/app/contact/page';
import FAQPage from '@/app/faq/page';
import HowToPlayPage from '@/app/how-to-play/page';

const realUA = navigator.userAgent;
const setWidth = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  act(() => void window.dispatchEvent(new Event('resize')));
};
const setUA = (ua: string) => Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  setUA(realUA);
});
afterEach(() => {
  setUA(realUA);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

// Desktop layouts add animated background blobs (privacy/terms use animate-pulse, the others animate-pulse-optimized).
const isDesktopLayout = (container: HTMLElement) => container.querySelector('.animate-pulse-optimized, .will-change-opacity') !== null;

describe.each([
  ['privacy', PrivacyPolicy],
  ['terms', TermsOfService],
  ['disclaimer', DisclaimerPage],
  ['faq', FAQPage],
])('%s page', (_name, Page) => {
  it('uses the full background on desktop and a light one on small screens', () => {
    const { container, unmount } = render(<Page />);
    expect(isDesktopLayout(container)).toBe(true);
    setWidth(500);
    expect(isDesktopLayout(container)).toBe(false);
    unmount();
  });
});

describe.each([
  ['disclaimer', DisclaimerPage],
  ['faq', FAQPage],
])('%s page on a phone browser', (_name, Page) => {
  it('detects mobile from the user agent even on a wide screen', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    const { container } = render(<Page />);
    expect(isDesktopLayout(container)).toBe(false);
  });
});

describe('FAQ page', () => {
  it('opens one answer at a time', () => {
    render(<FAQPage />);
    const first = screen.getByRole('button', { name: /What is 1Think 2Win\?/ });
    expect(first).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const second = screen.getByRole('button', { name: /How do I participate in quizzes\?/ });
    fireEvent.click(second);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('How to play page', () => {
  it('scrolls to the steps from the hero buttons', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<HowToPlayPage />);
    expect(screen.getAllByRole('link', { name: /quizzes|Quiz/i }).some((l) => l.getAttribute('href') === '/quizzes')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Get Started/ }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
    // the bouncing chevron under the hero scrolls too
    fireEvent.click(document.querySelector('.lucide-chevron-down')!.parentElement!);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});

// /contact and /how-to-play read the wallet switch from /api/settings/wallet-enabled in the browser
const walletFlag = (answer: boolean | 'fail' | 'pending' | 'bad' | 'error') => {
  const fetchMock = vi.fn((url: string) => {
    expect(url).toBe('/api/settings/wallet-enabled');
    if (answer === 'pending') return new Promise<Response>(() => {});
    if (answer === 'fail') return Promise.reject(new Error('offline'));
    if (answer === 'error') return Promise.resolve(jsonResponse({ error: 'x' }, 500));
    return Promise.resolve(jsonResponse(answer === 'bad' ? { walletEnabled: 'yes' } : { walletEnabled: answer }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('Contact page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the official email, with the subject filled in for each topic', async () => {
    walletFlag(true);
    render(<ContactPage />);
    expect(screen.getByRole('link', { name: '1think2wins@gmail.com' })).toHaveAttribute('href', 'mailto:1think2wins@gmail.com');
    expect(screen.getByRole('link', { name: /Send an email/ }).getAttribute('href')).toBe('mailto:1think2wins@gmail.com?subject=%5B1Think%202Win%5D%20Support%20request');
    expect(await screen.findByRole('heading', { name: 'Wallet & deposits' })).toBeInTheDocument();
    expect(screen.getByText(/a prize or a deposit\?/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Account & sign-in/ }).getAttribute('href')).toContain('subject=%5B1Think%202Win%5D%20Account%20help');
    expect(document.body.textContent).not.toMatch(/XXX|support@1think2win\.com/);
  });

  it.each([false, 'fail', 'error', 'bad', 'pending'] as const)('leaves out the wallet topic when the wallet is not on (%s)', async (answer) => {
    walletFlag(answer);
    render(<ContactPage />);
    expect(await screen.findByRole('heading', { name: 'Prizes & delivery' })).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByRole('heading', { name: 'Wallet & deposits' })).toBeNull();
  });

  it('copies the address, and says so for two seconds', async () => {
    walletFlag(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.useFakeTimers();
    render(<ContactPage />);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Copy email address' })));
    expect(writeText).toHaveBeenCalledWith('1think2wins@gmail.com');
    expect(screen.getByRole('button', { name: 'Email address copied' })).toHaveTextContent('Copied');
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByRole('button', { name: 'Copy email address' })).toBeInTheDocument();
  });

  it('keeps the address on screen when the clipboard is blocked', async () => {
    walletFlag(false);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<ContactPage />);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Copy email address' })));
    expect(screen.getByRole('button', { name: 'Copy email address' })).toHaveTextContent('Copy');
  });

  it('opens the chat assistant', () => {
    walletFlag(false);
    const opened = vi.fn();
    window.addEventListener(OPEN_CHATBOT_EVENT, opened);
    render(<ContactPage />);
    fireEvent.click(screen.getByRole('button', { name: /Open the chat/ }));
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_CHATBOT_EVENT, opened);
  });

  it('links the other help pages', () => {
    walletFlag('pending');
    render(<ContactPage />);
    const nav = screen.getByRole('navigation', { name: 'Help pages' });
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/how-to-play', '/faq', '/terms', '/privacy']);
  });
});

describe('How to play page and the wallet switch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('explains the wallet and the day pass when the wallet is on', async () => {
    walletFlag(true);
    render(<HowToPlayPage />);
    expect(await screen.findByRole('heading', { name: 'Top up your wallet' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Get a day pass' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Your 5-Step/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /How do I add money to my wallet/ })).toBeInTheDocument();
    expect(screen.getByText('Free account')).toBeInTheDocument();
  });

  it('says every quiz is free when the wallet is off', async () => {
    walletFlag(false);
    render(<HowToPlayPage />);
    expect(await screen.findByRole('heading', { name: /Your 4-Step/ })).toBeInTheDocument();
    expect(screen.getByText(/Every quiz is free to play right now/)).toBeInTheDocument();
    expect(screen.getByText('100% free quizzes')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Top up your wallet' })).toBeNull();
    expect(screen.queryByRole('button', { name: /add money to my wallet/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Free Entry/ }));
    expect(await screen.findByText('No payment details')).toBeInTheDocument();
  });

  it('uses wording true either way until the switch is known', async () => {
    walletFlag('pending');
    render(<HowToPlayPage />);
    expect(screen.getByText(/If it needs a day pass you see the price before paying/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Entry & Wallet/ }));
    expect(await screen.findByText('Free or day pass')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/2 PKR|randomly selected|10 Minutes/);
  });
});
