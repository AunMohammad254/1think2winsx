import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

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
  ['contact', ContactPage],
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
  ['contact', ContactPage],
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
