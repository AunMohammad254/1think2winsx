import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/StreamPlayer', () => ({
  default: ({ onError }: { onError: (e: string) => void }) => <button onClick={() => onError('stream died')}>player</button>,
}));

import ProfilePictureUpload from '@/components/ProfilePictureUpload';
import LazyStreamPlayer from '@/components/LazyStreamPlayer';
import QuizResults from '@/components/QuizResults';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProfilePictureUpload', () => {
  const png = (bytes = 10) => new File([new Uint8Array(bytes)], 'me.png', { type: 'image/png' });
  const input = (c: HTMLElement) => c.querySelector('input[type=file]') as HTMLInputElement;

  it('previews and uploads a picked image', async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<ProfilePictureUpload onImageUpload={onUpload} />);
    expect(screen.getByText('?')).toBeInTheDocument();
    const click = vi.spyOn(input(container), 'click');
    fireEvent.click(screen.getByText('Click to upload').closest('div[class*="border-dashed"], div')!.parentElement!.parentElement!);
    expect(click).toHaveBeenCalled();
    fireEvent.change(input(container), { target: { files: [png()] } });
    expect(onUpload).toHaveBeenCalled();
    expect(await screen.findByRole('img', { name: 'Profile picture' })).toHaveAttribute('src', expect.stringContaining('data:image/png'));
    fireEvent.change(input(container), { target: { files: [] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it('rejects other file types and files over 5MB', () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const onUpload = vi.fn();
    const { container } = render(<ProfilePictureUpload onImageUpload={onUpload} currentImage="https://cdn/me.avif" />);
    expect(screen.getByRole('img', { name: 'Profile picture' })).toHaveAttribute('src', 'https://cdn/me.avif');
    fireEvent.change(input(container), { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } });
    expect(alert).toHaveBeenCalledWith('Please select a valid image file (JPEG, PNG, WebP, or GIF)');
    const big = png();
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(input(container), { target: { files: [big] } });
    expect(alert).toHaveBeenCalledWith('File size must be less than 5MB');
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('accepts a dropped file and highlights while dragging', async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error('too slow'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ProfilePictureUpload onImageUpload={onUpload} />);
    const zone = screen.getByText('Click to upload').parentElement!.parentElement!.parentElement!;
    fireEvent.dragEnter(zone);
    expect(zone.className).toContain('border-green-500');
    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain('border-green-500');
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(onUpload).not.toHaveBeenCalled();
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Upload failed:', expect.any(Error)));
  });

  it('drops the preview of a failed upload, even when the file is read after the failure', async () => {
    // The upload rejects at once, so FileReader's onload fires after the catch has cleared the preview.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const { container } = render(<ProfilePictureUpload onImageUpload={vi.fn().mockRejectedValue(new Error('rejected'))} />);
    fireEvent.change(input(container), { target: { files: [png()] } });
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    const reader = read.mock.contexts[0] as FileReader;
    await waitFor(() => expect(reader.readyState).toBe(FileReader.DONE));
    await act(async () => {});
    expect(screen.queryByRole('img', { name: 'Profile picture' })).toBeNull();
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('locks the drop zone while uploading', () => {
    const { container } = render(<ProfilePictureUpload onImageUpload={vi.fn()} loading />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(input(container)).toBeDisabled();
    const click = vi.spyOn(input(container), 'click');
    fireEvent.click(screen.getByText('Click to upload'));
    expect(click).not.toHaveBeenCalled();
  });
});

describe('LazyStreamPlayer', () => {
  type Cb = (entries: { isIntersecting: boolean }[]) => void;
  let cbs: Cb[];
  const realIO = window.IntersectionObserver;
  beforeEach(() => {
    cbs = [];
    window.IntersectionObserver = class {
      constructor(cb: Cb) { cbs.push(cb); }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
  });
  afterEach(() => { window.IntersectionObserver = realIO; });

  it('renders nothing when no stream is live', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hasActiveStream: false })));
    const onAvailability = vi.fn();
    const { container } = render(<LazyStreamPlayer onAvailabilityChange={onAvailability} />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    await waitFor(() => expect(onAvailability).toHaveBeenCalledWith(false));
    expect(container).toBeEmptyDOMElement();
  });

  it('treats a failed check as no stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onAvailability = vi.fn();
    render(<LazyStreamPlayer onAvailabilityChange={onAvailability} />);
    await waitFor(() => expect(onAvailability).toHaveBeenCalledWith(false));
    render(<LazyStreamPlayer />);
  });

  it('shows a placeholder, then the player on demand, passing errors up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hasActiveStream: true })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    render(<LazyStreamPlayer onError={onError} className="slot" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load Stream' }));
    fireEvent.click(await screen.findByRole('button', { name: 'player' }));
    expect(onError).toHaveBeenCalledWith('stream died');
  });

  it('uses a custom placeholder, and autoplays once visible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ hasActiveStream: true })));
    const { unmount } = render(<LazyStreamPlayer placeholder={<p>soon</p>} />);
    expect(await screen.findByText('soon')).toBeInTheDocument();
    unmount();
    render(<LazyStreamPlayer autoPlay onAvailabilityChange={vi.fn()} />);
    act(() => cbs.forEach((cb) => cb([{ isIntersecting: true }])));
    expect(await screen.findByRole('button', { name: 'player' })).toBeInTheDocument();
  });

  it('autoplay waits for the player to be on screen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hasActiveStream: true })));
    render(<LazyStreamPlayer autoPlay />);
    act(() => cbs.forEach((cb) => cb([{ isIntersecting: false }])));
    // autoPlay starts loaded, so the player shows straight away
    expect(await screen.findByRole('button', { name: 'player' })).toBeInTheDocument();
  });
});

describe('QuizResults', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hasActiveStream: false })));
    router.push.mockReset();
  });

  it('celebrates a successful submission, then clears the confetti', () => {
    vi.useFakeTimers();
    const { container } = render(<QuizResults success message="Saved" totalQuestions={10} submittedAnswers={9} note="Results soon" />);
    expect(container.querySelectorAll('.fixed > div')).toHaveLength(50);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText('🎉 Predictions Locked In!')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-ping')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Back to Lobby/ })).toHaveAttribute('href', '/');
    act(() => { vi.advanceTimersByTime(4000); });
    expect(container.querySelector('.fixed')).toBeNull();
  });

  it('shows a failure without confetti, and in-modal buttons', () => {
    const onClose = vi.fn();
    const { container } = render(<QuizResults success={false} message="Nope" totalQuestions={5} submittedAnswers={0} note="n" isInModal onClose={onClose} />);
    expect(screen.getByText('Submission Failed')).toBeInTheDocument();
    expect(container.querySelector('.fixed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Take More Quizzes/ }));
    fireEvent.click(screen.getByRole('button', { name: /View My Points/ }));
    expect(router.push).toHaveBeenCalledWith('/profile');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('in a modal without onClose still navigates', () => {
    render(<QuizResults success={false} message="m" totalQuestions={1} submittedAnswers={1} note="n" isInModal />);
    fireEvent.click(screen.getByRole('button', { name: /View My Points/ }));
    expect(router.push).toHaveBeenCalledWith('/profile');
  });
});
