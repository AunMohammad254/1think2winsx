import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

import StreamPlayer, { getResponsiveClasses } from '@/components/StreamPlayer';
import { isStreamFullscreen, STREAM_FULLSCREEN_ATTR } from '@/lib/stream-fullscreen';

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
  // @ts-expect-error test cleanup
  delete document.fullscreenEnabled;
  for (const key of ['webkitFullscreenEnabled', 'webkitFullscreenElement', 'webkitExitFullscreen']) delete (document as unknown as Record<string, unknown>)[key];
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).webkitRequestFullscreen;
  Object.defineProperty(window.screen, 'orientation', { configurable: true, value: undefined });
});

const iframe = () => screen.findByTitle(/PSL Final|Livestream|FB title/);
const viewer = () => screen.getByRole('application', { name: 'Live stream viewer' });
const setFullscreenElement = (el: Element | null) => {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
  act(() => void document.dispatchEvent(new Event('fullscreenchange')));
};
/** A browser with the Fullscreen API (desktop, Android). */
const nativeFullscreen = (request = vi.fn(async () => {}), exit = vi.fn(async () => {})) => {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  HTMLElement.prototype.requestFullscreen = request;
  document.exitFullscreen = exit;
  return { request, exit };
};
const orientation = (value: unknown) => Object.defineProperty(window.screen, 'orientation', { configurable: true, value });
const enter = () => fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
const exitButton = () => screen.getByRole('button', { name: 'Exit fullscreen' });

describe('getResponsiveClasses', () => {
  it('caps the width per breakpoint', () => {
    expect([2000, 1200, 800, 400].map(getResponsiveClasses)).toEqual([
      'aspect-video max-w-[1600px] mx-auto', 'aspect-video max-w-[1024px] mx-auto', 'aspect-video max-w-[768px] mx-auto', 'aspect-video w-full',
    ]);
  });
});

describe('StreamPlayer', () => {
  it("plays a YouTube stream through the embed URL, with the embed's own fullscreen turned off", async () => {
    render(<StreamPlayer className="slot" />);
    expect(screen.getByText('Loading stream...')).toBeInTheDocument();
    const frame = await iframe();
    // fs=0 hides YouTube's button, playsinline keeps iPhones from opening their own player
    expect(frame).toHaveAttribute('src', 'https://www.youtube.com/embed/abc123XYZ_0?autoplay=1&playsinline=1&fs=0&rel=0&iv_load_policy=3');
    // Without `fullscreen` in `allow`, the embed can't go fullscreen at all (not even on double-click)
    expect(frame.getAttribute('allow')).not.toContain('fullscreen');
    // YouTube refuses to play without knowing the embedding site
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    // Until the player has loaded, the box says what is happening instead of staying black
    expect(screen.getByText('Connecting to the stream…')).toBeInTheDocument();
    // One title bar with one LIVE badge and one fullscreen button
    expect(screen.getAllByText('Final')).toHaveLength(1);
    expect(screen.getAllByText('LIVE')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /fullscreen/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Toggle settings' })).toBeNull();
    fireEvent.load(frame);
    expect(screen.queryByText('Connecting to the stream…')).toBeNull();
  });

  it("plays pasted YouTube code the player didn't recognise before (privacy mode, channel live) in our own player", async () => {
    fetchMock.mockResolvedValueOnce(active({ id: 's5', name: 'Channel', title: 'Channel live', embedHtml: '<iframe src="https://www.youtube.com/embed/live_stream?channel=UC42" allowfullscreen></iframe>' }));
    const { unmount } = render(<StreamPlayer />);
    expect(await screen.findByTitle('Channel live')).toHaveAttribute('src', 'https://www.youtube.com/embed/live_stream?channel=UC42&autoplay=1&playsinline=1&fs=0&rel=0&iv_load_policy=3');
    unmount();
    fetchMock.mockResolvedValueOnce(active({ id: 's6', name: 'Private', title: 'Privacy mode', embedHtml: '<iframe src="https://www.youtube-nocookie.com/embed/NOCOOK1" allowfullscreen></iframe>' }));
    render(<StreamPlayer />);
    const frame = await screen.findByTitle('Privacy mode');
    expect(frame.getAttribute('src')).toMatch(/^https:\/\/www\.youtube\.com\/embed\/NOCOOK1\?.*fs=0/);
    expect(frame).toHaveClass('w-full', 'h-full');
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

  it('goes fullscreen through the Fullscreen API, turning phones sideways, and follows the browser out', async () => {
    const { request, exit } = nativeFullscreen();
    const lock = vi.fn(async () => {});
    const unlock = vi.fn();
    orientation({ lock, unlock });
    render(<StreamPlayer />);
    await iframe();
    enter();
    await waitFor(() => expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' }));
    // Not fullscreen until the browser says so
    expect(viewer()).not.toHaveAttribute(STREAM_FULLSCREEN_ATTR);
    setFullscreenElement(viewer());
    await waitFor(() => expect(lock).toHaveBeenCalledWith('landscape'));
    expect(viewer()).toHaveAttribute(STREAM_FULLSCREEN_ATTR, 'native');
    expect(isStreamFullscreen()).toBe(true);
    // The title bar steps aside; a single exit button sits over the video
    expect(screen.queryByText('Final')).toBeNull();
    expect(screen.getAllByRole('button', { name: /fullscreen/ })).toHaveLength(1);
    fireEvent.keyDown(viewer(), { key: 'F' });
    await waitFor(() => expect(exit).toHaveBeenCalled());
    setFullscreenElement(null);
    expect(unlock).toHaveBeenCalled();
    expect(viewer()).not.toHaveAttribute(STREAM_FULLSCREEN_ATTR);
    expect(isStreamFullscreen()).toBe(false);
    expect(screen.getByText('Final')).toBeInTheDocument();
    fireEvent.keyDown(viewer(), { key: 'x' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('logs a failed exit, and copes with no orientation lock', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    nativeFullscreen(undefined, vi.fn(async () => { throw new Error('not fullscreen'); }));
    render(<StreamPlayer />);
    await iframe();
    // Desktop browsers refuse the lock; iOS has none at all
    orientation({ lock: vi.fn(async () => { throw new Error('denied'); }) });
    setFullscreenElement(viewer());
    fireEvent.click(exitButton());
    await waitFor(() => expect(err).toHaveBeenCalledWith('Leaving fullscreen failed', expect.any(Error)));
    orientation({});
    setFullscreenElement(null);
    setFullscreenElement(viewer());
    orientation(undefined);
    setFullscreenElement(null);
    expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeInTheDocument();
  });

  it('fills the window with CSS where the browser has no Fullscreen API (iPhone), and leaves it on Esc', async () => {
    document.documentElement.style.overflow = 'auto';
    render(<StreamPlayer />);
    await iframe();
    enter();
    expect(viewer()).toHaveAttribute(STREAM_FULLSCREEN_ATTR, 'immersive');
    // The page behind can't scroll
    expect(document.documentElement.style.overflow).toBe('hidden');
    // Unrelated fullscreen changes and keys leave it alone
    setFullscreenElement(null);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(viewer()).toHaveAttribute(STREAM_FULLSCREEN_ATTR, 'immersive');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(viewer()).not.toHaveAttribute(STREAM_FULLSCREEN_ATTR);
    expect(document.documentElement.style.overflow).toBe('auto');
    // And from the exit button
    enter();
    fireEvent.click(exitButton());
    expect(viewer()).not.toHaveAttribute(STREAM_FULLSCREEN_ATTR);
  });

  it('asks again without options when the browser rejects them', async () => {
    const { request } = nativeFullscreen(vi.fn().mockRejectedValueOnce(new TypeError('bad options')).mockResolvedValueOnce(undefined));
    render(<StreamPlayer />);
    await iframe();
    enter();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls).toEqual([[{ navigationUI: 'hide' }], []]);
    // The second request worked, so the window is not filled with CSS
    await act(async () => {});
    expect(viewer()).not.toHaveAttribute(STREAM_FULLSCREEN_ATTR);
  });

  it('uses the webkit-prefixed Fullscreen API (older Safari, iPad)', async () => {
    const doc = document as unknown as Record<string, unknown>;
    const request = vi.fn(async () => {});
    const exit = vi.fn(async () => {});
    doc.webkitFullscreenEnabled = true;
    doc.webkitExitFullscreen = exit;
    (HTMLElement.prototype as unknown as Record<string, unknown>).webkitRequestFullscreen = request;
    render(<StreamPlayer />);
    await iframe();
    enter();
    await waitFor(() => expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' }));
    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => viewer() });
    act(() => void document.dispatchEvent(new Event('webkitfullscreenchange')));
    expect(viewer()).toHaveAttribute(STREAM_FULLSCREEN_ATTR, 'native');
    fireEvent.click(exitButton());
    await waitFor(() => expect(exit).toHaveBeenCalled());
  });

  it('falls back to filling the window when the browser refuses fullscreen', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    nativeFullscreen(vi.fn(async () => { throw new Error('not allowed'); }));
    render(<StreamPlayer />);
    await iframe();
    enter();
    await waitFor(() => expect(viewer()).toHaveAttribute(STREAM_FULLSCREEN_ATTR, 'immersive'));
    expect(warn).toHaveBeenCalledWith('Fullscreen request refused, filling the window instead', expect.any(Error));
  });

  it('fills the window when the browser never answers the request (some in-app browsers), and a late success still wins', async () => {
    let grant!: () => void;
    const request = vi.fn(() => new Promise<void>((resolve) => { grant = resolve; }));
    nativeFullscreen(request);
    render(<StreamPlayer />);
    await iframe();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      enter();
      await act(async () => { await vi.advanceTimersByTimeAsync(1499); });
      expect(viewer()).not.toHaveAttribute(STREAM_FULLSCREEN_ATTR);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(viewer()).toHaveAttribute(STREAM_FULLSCREEN_ATTR, 'immersive');
    } finally {
      vi.useRealTimers();
    }
    await act(async () => grant());
    setFullscreenElement(viewer());
    expect(viewer()).toHaveAttribute(STREAM_FULLSCREEN_ATTR, 'native');
  });

  it('puts a separate target in fullscreen so the quiz beside the player comes along', async () => {
    const { request } = nativeFullscreen();
    document.body.insertAdjacentHTML('beforeend', '<div id="stage"></div>');
    const stage = document.getElementById('stage')!;
    render(<StreamPlayer fullscreenTargetId="stage" />);
    await iframe();
    enter();
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.contexts[0]).toBe(stage);
    // Another element going fullscreen is not ours
    setFullscreenElement(viewer());
    expect(stage).not.toHaveAttribute(STREAM_FULLSCREEN_ATTR);
    setFullscreenElement(stage);
    expect(stage).toHaveAttribute(STREAM_FULLSCREEN_ATTR, 'native');
    setFullscreenElement(null);
    stage.remove();

    // A target that isn't on the page: nothing to put in fullscreen
    render(<StreamPlayer fullscreenTargetId="missing" />);
    await waitFor(() => expect(screen.getAllByRole('application')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter fullscreen' }).at(-1)!);
    expect(request).toHaveBeenCalledTimes(1);
    expect(isStreamFullscreen()).toBe(false);
  });
});
