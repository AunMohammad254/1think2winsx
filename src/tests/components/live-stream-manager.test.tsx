import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  getStreamConfig: vi.fn(),
  updateStreamConfig: vi.fn(),
  toggleStreamStatus: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/actions/streaming-actions', () => ({
  getStreamConfig: (...a: unknown[]) => h.getStreamConfig(...a),
  updateStreamConfig: (...a: unknown[]) => h.updateStreamConfig(...a),
  toggleStreamStatus: (...a: unknown[]) => h.toggleStreamStatus(...a),
}));

import LiveStreamManager from '@/components/admin/LiveStreamManager';

const YT = '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe>';
const config = (over: Record<string, unknown> = {}) => ({ id: 's1', embedHtml: YT, embedUrl: null, title: 'Final', platform: 'youtube', isActive: true, ...over });

beforeEach(() => {
  for (const f of [h.toast.success, h.toast.error, h.toast.info]) f.mockReset();
  h.getStreamConfig.mockReset().mockResolvedValue(config());
  h.updateStreamConfig.mockReset().mockImplementation(async (input: Record<string, unknown>) => ({ success: true, data: config(input) }));
  h.toggleStreamStatus.mockReset().mockResolvedValue({ success: true });
});

const embed = () => screen.getByPlaceholderText(/Paste your livestream embed HTML here/);
const title = () => screen.getByPlaceholderText('Enter stream title');
const loaded = () => screen.findByDisplayValue('Final');

describe('LiveStreamManager', () => {
  it('loads the saved configuration', async () => {
    render(<LiveStreamManager />);
    expect(screen.getByText('Loading configuration...')).toBeInTheDocument();
    await loaded();
    expect(embed()).toHaveValue(YT);
    expect(screen.getByText('Stream is live and visible to users')).toBeInTheDocument();
    expect(screen.getByText('youtube')).toBeInTheDocument();
    expect(screen.getByTitle('Draft embed preview')).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('starts empty when loading fails, and fills defaults for missing fields', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.getStreamConfig.mockRejectedValueOnce(new Error('db'));
    const { unmount } = render(<LiveStreamManager />);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to load stream configuration'));
    expect(screen.getByText('No Stream Configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go Live/ })).toBeDisabled();
    unmount();
    h.getStreamConfig.mockResolvedValueOnce({ id: 's', embedHtml: null, title: null, platform: null, isActive: null });
    render(<LiveStreamManager />);
    expect(await screen.findByDisplayValue('Livestream')).toBeInTheDocument();
    expect(screen.getByText('custom')).toBeInTheDocument();
  });

  it('validates the embed code as it is typed', async () => {
    render(<LiveStreamManager />);
    await loaded();
    const check = (value: string, message: string) => {
      fireEvent.change(embed(), { target: { value } });
      expect(screen.getByText(message)).toBeInTheDocument();
    };
    check('short', 'Enter at least 10 characters');
    check('<script>alert(1)</script>', 'Script tags are not allowed');
    check('https://example.com/live', 'Valid URL detected');
    check('just some words here', 'Must contain iframe, video, or embed tag');
    check('ftp://example.com/file.mp4', 'Must contain iframe, video, or embed tag');
    check('<video src="https://cdn/x.mp4"></video>', 'Valid embed code');
    expect(screen.getByRole('button', { name: /Save Changes/ })).toBeEnabled();
    check('', 'Enter at least 10 characters');
    expect(screen.getByText('No Stream Configured')).toBeInTheDocument();
  });

  it('saves changes and reports whether the stream is live', async () => {
    render(<LiveStreamManager />);
    await loaded();
    fireEvent.change(title(), { target: { value: 'Semi Final' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Stream configuration saved!', expect.objectContaining({ description: 'Stream is now live' })));
    expect(h.updateStreamConfig).toHaveBeenCalledWith({ embedHtml: YT, title: 'Semi Final', platform: 'youtube', isActive: true }, '');
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  });

  it('saves an inactive stream, and keeps state when the server returns no data', async () => {
    h.getStreamConfig.mockResolvedValueOnce(config({ isActive: false }));
    h.updateStreamConfig.mockResolvedValueOnce({ success: true });
    render(<LiveStreamManager />);
    await loaded();
    fireEvent.change(title(), { target: { value: 'Later' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Stream configuration saved!', expect.objectContaining({ description: 'Stream is saved but not active' })));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('reports save failures', async () => {
    render(<LiveStreamManager />);
    await loaded();
    fireEvent.change(title(), { target: { value: 'X' } });
    const save = () => fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    h.updateStreamConfig.mockResolvedValueOnce({ success: false, error: 'Embed host not allowed' });
    save();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Embed host not allowed'));
    h.updateStreamConfig.mockResolvedValueOnce({ success: false });
    save();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to save'));
    h.updateStreamConfig.mockRejectedValueOnce(new Error('Not authorised'));
    save();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Not authorised'));
    h.updateStreamConfig.mockRejectedValueOnce('odd');
    save();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(4));
    expect(h.toast.error).toHaveBeenLastCalledWith('Failed to save');
  });

  it('goes offline and live again', async () => {
    render(<LiveStreamManager />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /Go Offline/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Stream deactivated', expect.anything()));
    expect(h.toggleStreamStatus).toHaveBeenCalledWith(false, '');
    expect(screen.getByText('Stream is offline')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Go Live/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Stream activated!', expect.anything()));
  });

  it('reports toggle failures', async () => {
    render(<LiveStreamManager />);
    await loaded();
    h.toggleStreamStatus.mockResolvedValueOnce({ success: false, error: 'Nope' }).mockResolvedValueOnce({ success: false }).mockRejectedValueOnce(new Error('x'));
    const toggle = () => fireEvent.click(screen.getByRole('button', { name: /Go Offline/ }));
    toggle();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Nope'));
    toggle();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to toggle status'));
    toggle();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to toggle stream status'));
    expect(screen.getByText('Stream is live and visible to users')).toBeInTheDocument();
  });

  it('discards unsaved edits', async () => {
    render(<LiveStreamManager />);
    await loaded();
    fireEvent.change(title(), { target: { value: 'Changed' } });
    fireEvent.change(embed(), { target: { value: '<iframe src="https://www.facebook.com/plugins/video.php"></iframe>' } });
    expect(screen.getByText('facebook')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Discard Changes/ }));
    expect(h.toast.info).toHaveBeenCalledWith('Changes discarded');
    expect(title()).toHaveValue('Final');
    expect(embed()).toHaveValue(YT);
  });

  it('discards back to defaults when nothing was saved', async () => {
    h.getStreamConfig.mockRejectedValueOnce(new Error('x'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<LiveStreamManager />);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    fireEvent.change(title(), { target: { value: 'Something' } });
    fireEvent.click(screen.getByRole('button', { name: /Discard Changes/ }));
    expect(title()).toHaveValue('Livestream');
  });

  it('switches preview device, source and visibility', async () => {
    h.getStreamConfig.mockResolvedValueOnce(config({ isActive: false, platform: 'twitch' }));
    render(<LiveStreamManager />);
    await loaded();
    fireEvent.click(screen.getByTitle('Mobile'));
    expect(screen.getByText('Mobile View')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Tablet'));
    expect(screen.getByText('Tablet View')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Desktop'));
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
    expect(screen.getByText('Saved Preview')).toBeInTheDocument();
    expect(screen.getByText('No Active Stream')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Go Live/ }));
    await waitFor(() => expect(screen.getByTitle('Draft embed preview')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    expect(screen.getByText('Draft Preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hide/ }));
    expect(screen.getByText('Preview hidden')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Show$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hide/ }));
    fireEvent.click(screen.getByRole('button', { name: /Show Preview/ }));
    expect(screen.queryByText('Preview hidden')).toBeNull();
  });
});
