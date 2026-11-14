import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import OfflineBanner from '@/components/OfflineBanner';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

let online = true;
const goOffline = () => { online = false; window.dispatchEvent(new Event('offline')); };
const goOnline = () => { online = true; window.dispatchEvent(new Event('online')); };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  online = true;
});

describe('OfflineBanner', () => {
  it('shows while offline, says "back online" for a few seconds, then hides', () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const { unmount } = render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();

    act(goOffline);
    expect(screen.getByRole('status')).toHaveTextContent('No internet connection');

    act(goOnline);
    expect(screen.getByRole('status')).toHaveTextContent("You're back online.");
    // dropping again cancels the "back online" timer
    act(goOffline);
    act(goOnline);
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();

    act(goOffline);
    act(goOnline);
    unmount(); // clears the pending timer and the listeners
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});

describe('useOnlineStatus', () => {
  it('assumes online while rendering on the server', () => {
    function Probe() { return <span>{String(useOnlineStatus())}</span>; }
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(renderToString(<Probe />)).toContain('true');
  });
});
