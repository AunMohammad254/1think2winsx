import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

import StreamPlayer, { getResponsiveClasses } from '@/components/StreamPlayer';

const YT = '<iframe src="https://www.youtube.com/embed/abc123XYZ_0" allowfullscreen></iframe>';
let fetchMock: ReturnType<typeof vi.fn>;
const active = (stream: Record<string, unknown>) => jsonResponse({ hasActiveStream: true, stream });

beforeEach(() => {
  fetchMock = vi.fn(async () => active({ id: 's1', name: 'Final', title: 'PSL Final', embedHtml: YT }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // @ts-expect-error test cleanup
  delete HTMLElement.prototype.requestFullscreen;
  // @ts-expect-error test cleanup
  delete document.exitFullscreen;
  // @ts-expect-error test cleanup
  delete document.fullscreenElement;
});

const iframe = () => screen.findByTitle(/PSL Final|Livestream|FB title/);
const setFullscreenElement = (el: Element | null) => {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
  act(() => void document.dispatchEvent(new Event('fullscreenchange')));
};

describe('getResponsiveClasses', () => {
  it('caps the width per breakpoint', () => {
    expect([2000, 1200, 800, 400].map(getResponsiveClasses)).toEqual([
      'aspect-video max-w-[1600px] mx-auto', 'aspect-video max-w-[1024px] mx-auto', 'aspect-video max-w-[768px] mx-auto', 'aspect-video w-full',
    ]);
  });
});

describe('StreamPlayer', () => {
  it('plays a YouTube stream through the embed URL', async () => {
    render(<StreamPlayer className="slot" />);
    expect(screen.getByText('Loading stream...')).toBeInTheDocument();
    const frame = await iframe();
    expect(frame).toHaveAttribute('src', 'https://www.youtube.com/embed/abc123XYZ_0?autoplay=1&rel=0&modestbranding=1&fs=1');
    expect(screen.getAllByText('Final')).toHaveLength(2);
    fireEvent.load(frame);
  });

  it('wraps other embeds in an isolated data URI, with title fallbacks', async () => {
    fetchMock.mockResolvedValueOnce(active({ id: 's2', facebookLiveVideo: { embedHtml: '<iframe src="https://www.facebook.com/plugins/video.php"></iframe>' } }));
    const { unmount } = render(<StreamPlayer />);
    const frame = await screen.findByTitle('Livestream');
    expect(frame.getAttribute('src')).toMatch(/^data:text\/html/);
    expect(screen.getAllByText('Livestream').length).toBeGreaterThan(0);
    unmount();
    fetchMock.mockResolvedValueOnce(active({ id: 's3', facebookLiveVideo: { title: 'FB title', embedHtml: '<video src="x"></video>' }, name: 'FB' }));
    render(<StreamPlayer />);
    expect(await screen.findByTitle('FB title')).toBeInTheDocument();
  });

  it('uses defaults for an untitled plain embed', async () => {
    fetchMock.mockResolvedValueOnce(active({ id: 's4', embedHtml: '<video src="https://cdn/v.mp4"></video>' }));
    render(<StreamPlayer />);
    expect(await screen.findByTitle('Livestream')).toBeInTheDocument();
  });

  it('shows when nothing is live, and retries', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hasActiveStream: false }));
    render(<StreamPlayer />);
    expect(await screen.findByText('No active stream available')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading stream' }));
    expect(await iframe()).toBeInTheDocument();
  });

  it('reports a failed load to the parent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const onError = vi.fn();
    render(<StreamPlayer onError={onError} />);
    expect(await screen.findByText('Failed to load stream')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith('Failed to load stream');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<StreamPlayer />);
    await waitFor(() => expect(screen.getAllByText('Failed to load stream')).toHaveLength(2));
  });

  it('KNOWN BUG: the iframe onError handler never runs, so "Stream failed to load" cannot appear', async () => {
    // React attaches only a load listener to <iframe> (and browsers do not fire error for a
    // failed iframe document), so handleIframeError is dead code.
    render(<StreamPlayer />);
    fireEvent.error(await iframe());
    expect(screen.queryByText('Stream failed to load')).toBeNull();
  });

  it('toggles the viewer settings panel', async () => {
    render(<StreamPlayer />);
    await iframe();
    const [mobile, desktop] = screen.getAllByRole('button', { name: 'Toggle settings' });
    fireEvent.click(mobile);
    expect(screen.getByText('Viewer Settings')).toBeInTheDocument();
    fireEvent.click(desktop);
    expect(screen.queryByText('Viewer Settings')).toBeNull();
  });

  it('enters and exits fullscreen on the player, locking landscape', async () => {
    const request = vi.fn(async () => {});
    const exit = vi.fn(async () => {});
    HTMLElement.prototype.requestFullscreen = request;
    document.exitFullscreen = exit;
    const lock = vi.fn(async () => {});
    const unlock = vi.fn();
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { lock, unlock } });
    render(<StreamPlayer />);
    await iframe();
    const viewer = screen.getByRole('application', { name: 'Live stream viewer' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter fullscreen' })[0]);
    await waitFor(() => expect(request).toHaveBeenCalled());
    setFullscreenElement(viewer);
    await waitFor(() => expect(lock).toHaveBeenCalledWith('landscape'));
    expect(screen.getAllByRole('button', { name: 'Exit fullscreen' })).toHaveLength(2);
    fireEvent.keyDown(viewer, { key: 'F' });
    await waitFor(() => expect(exit).toHaveBeenCalled());
    setFullscreenElement(null);
    expect(unlock).toHaveBeenCalled();
    fireEvent.keyDown(viewer, { key: 'x' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('copes with orientation lock refusal and missing fullscreen APIs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { lock: vi.fn(async () => { throw new Error('denied'); }) } });
    render(<StreamPlayer />);
    await iframe();
    const viewer = screen.getByRole('application', { name: 'Live stream viewer' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter fullscreen' })[0]); // no requestFullscreen: nothing happens
    setFullscreenElement(document.querySelector('iframe'));
    await waitFor(() => expect(log).toHaveBeenCalledWith('Screen orientation lock not supported or denied'));
    expect(screen.getAllByRole('button', { name: 'Exit fullscreen' }).length).toBe(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Exit fullscreen' })[0]); // no exitFullscreen either
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: undefined });
    setFullscreenElement(null);
    setFullscreenElement(viewer);
  });

  it('uses a separate fullscreen target, and logs a refused request', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.insertAdjacentHTML('beforeend', '<div id="stage"></div>');
    const stage = document.getElementById('stage')!;
    stage.requestFullscreen = vi.fn(async () => { throw new Error('not allowed'); });
    render(<StreamPlayer fullscreenTargetId="stage" />);
    await iframe();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter fullscreen' })[0]);
    await waitFor(() => expect(err).toHaveBeenCalledWith('Fullscreen toggle failed', expect.any(Error)));
    setFullscreenElement(stage);
    expect(screen.getAllByRole('button', { name: 'Exit fullscreen' })).toHaveLength(2);
    stage.remove();
    render(<StreamPlayer fullscreenTargetId="missing" />);
    await waitFor(() => expect(screen.getAllByRole('application')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter fullscreen' }).at(-1)!);
  });
});
