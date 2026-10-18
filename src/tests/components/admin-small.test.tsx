import '@/tests/helpers/ui';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  dynamics: [] as { loader: () => Promise<unknown>; opts: { loading: () => React.ReactNode } }[],
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>, opts: { loading: () => React.ReactNode }) => {
    h.dynamics.push({ loader, opts });
    return () => null;
  },
}));
for (const m of ['PlayerClaimsManager', 'LiveStreamManager', 'WalletTransactionsManager', 'QuizFormBuilder']) {
  vi.doMock(`@/components/admin/${m}`, () => ({ default: () => null }));
}
vi.mock('@/components/PrizeRedemption', () => ({ default: () => null }));

import QuestionList from '@/components/admin/questions/QuestionList';
import QuestionForm from '@/components/admin/questions/QuestionForm';
import PrizeTable from '@/components/admin/PrizeTable';
import PrizeForm from '@/components/admin/PrizeForm';
import WalletFeatureToggle from '@/components/admin/WalletFeatureToggle';
import * as DynamicAdmin from '@/components/admin/DynamicAdminComponents';
import type { Question } from '@/components/admin/questions/types';
import type { Prize } from '@/types/prize';
import { CLOUDINARY_CLOUD_NAME } from '@/lib/cloudinary';

const CLD = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

const q = (over: Partial<Question> = {}): Question => ({
  id: 'q1', quizId: 'z', text: 'Who won?', options: ['Karachi Kings', 'Lahore Qalandars'], correctOption: 0, hasCorrectAnswer: true, status: 'active', order: 0, ...over,
});

describe('QuestionList', () => {
  it('offers to add the first question when empty', () => {
    const onAddFirst = vi.fn();
    const { rerender } = render(<QuestionList questions={[]} isLoading={false} onEdit={vi.fn()} onToggleStatus={vi.fn()} onDelete={vi.fn()} onAddFirst={onAddFirst} />);
    fireEvent.click(screen.getByRole('button', { name: /Add First Question/ }));
    expect(onAddFirst).toHaveBeenCalled();
    rerender(<QuestionList questions={[]} isLoading onEdit={vi.fn()} onToggleStatus={vi.fn()} onDelete={vi.fn()} onAddFirst={onAddFirst} />);
    expect(screen.queryByText('No Questions Found')).toBeNull();
  });

  it('lists questions with their answer and actions', () => {
    const fns = { onEdit: vi.fn(), onToggleStatus: vi.fn(), onDelete: vi.fn() };
    render(<QuestionList questions={[q(), q({ id: 'q2', status: 'paused', hasCorrectAnswer: false, correctOption: null })]} isLoading={false} onAddFirst={vi.fn()} {...fns} />);
    expect(screen.getAllByText('Has Answer')).toHaveLength(1);
    expect(screen.getByText('paused')).toBeInTheDocument();
    const second = screen.getByText('Question 2').closest('.glass-card') as HTMLElement;
    const [edit, toggle, del] = within(second).getAllByRole('button');
    fireEvent.click(edit);
    fireEvent.click(toggle);
    fireEvent.click(del);
    expect(fns.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'q2' }));
    expect(fns.onToggleStatus).toHaveBeenCalledWith('q2', 'paused');
    expect(fns.onDelete).toHaveBeenCalledWith('q2');
  });
});

describe('QuestionForm', () => {
  const initial = { text: 'Q?', options: ['A', 'B', 'C'], correctOption: 2, hasCorrectAnswer: true, status: 'active' as const, order: 0 };
  const setup = (over: Partial<Parameters<typeof QuestionForm>[0]> = {}) => {
    const props = { isOpen: true, isEditing: false, initialData: initial, isLoading: false, onSave: vi.fn(), onClose: vi.fn(), ...over };
    render(<QuestionForm {...props} />);
    return props;
  };
  const save = () => fireEvent.click(screen.getByRole('button', { name: /Add Question|Update Question/ }));

  it('edits text, options, the correct answer and status', () => {
    const p = setup();
    fireEvent.change(screen.getByLabelText('Question Text'), { target: { value: 'Who won 1992?' } });
    fireEvent.change(screen.getByPlaceholderText('Option 1'), { target: { value: 'Pakistan' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Set Correct' })[0]);
    fireEvent.click(screen.getByRole('switch'));
    save();
    expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ text: 'Who won 1992?', options: ['Pakistan', 'B', 'C'], correctOption: 0, status: 'paused' }));
    fireEvent.click(screen.getByRole('switch'));
    save();
    expect(p.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('adds up to six options and keeps at least two, re-pointing the correct answer', () => {
    const p = setup();
    const add = () => fireEvent.click(screen.getByRole('button', { name: /Add Option/ }));
    add(); add(); add();
    expect(screen.getAllByPlaceholderText(/Option \d/)).toHaveLength(6);
    expect(screen.queryByRole('button', { name: /Add Option/ })).toBeNull();
    const removeButtons = () => screen.getAllByPlaceholderText(/Option \d/).map((i) => i.parentElement!.querySelectorAll('button')[1]).filter(Boolean);
    // remove option A (before the correct C): correct index shifts down to 1
    fireEvent.click(removeButtons()[0]);
    save();
    expect(p.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ correctOption: 1 }));
    // remove the correct option itself: no answer selected
    fireEvent.click(removeButtons()[1]);
    save();
    expect(p.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ correctOption: null }));
    // removing with no correct answer keeps it null; then stop at two
    fireEvent.click(removeButtons()[0]);
    fireEvent.click(removeButtons()[0]);
    expect(screen.getAllByPlaceholderText(/Option \d/)).toHaveLength(2);
    expect(removeButtons()).toHaveLength(0);
  });

  it('removing an option after the correct one keeps it, and toggling unsets it', () => {
    const p = setup({ initialData: { ...initial, correctOption: 0 } });
    const removeButtons = () => screen.getAllByPlaceholderText(/Option \d/).map((i) => i.parentElement!.querySelectorAll('button')[1]).filter(Boolean);
    fireEvent.click(removeButtons()[2]);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.querySelector('.lucide-check'))!);
    save();
    expect(p.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ options: ['A', 'B'], correctOption: null }));
  });

  it('shows edit wording, a busy state, and closes', async () => {
    const p = setup({ isEditing: true, isLoading: true });
    expect(screen.getByText('Edit Question')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update Question/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(2));
  });
});

const prize = (over: Partial<Prize> = {}): Prize => ({
  id: 'p1', name: 'Phone', description: 'Android', imageUrl: `${CLD}/a.png`, modelUrl: null, type: 'phone', pointsRequired: 1200,
  isActive: true, category: 'electronics', stock: 3, status: 'published', value: 50000, createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe('PrizeTable', () => {
  it('shows loading and empty states', () => {
    const fns = { onEdit: vi.fn(), onDelete: vi.fn(), onToggleStatus: vi.fn(), onToggleActive: vi.fn() };
    const { container, rerender } = render(<PrizeTable prizes={[]} loading {...fns} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    rerender(<PrizeTable prizes={[]} loading={false} {...fns} />);
    expect(screen.getByText('No prizes found')).toBeInTheDocument();
  });

  it('wires every action in both the table and the mobile cards', () => {
    const fns = { onEdit: vi.fn(), onDelete: vi.fn(), onToggleStatus: vi.fn(), onToggleActive: vi.fn() };
    render(<PrizeTable prizes={[prize(), prize({ id: 'p2', name: 'Cap', imageUrl: null, stock: 0, isActive: false, status: 'mystery' as Prize['status'] }), prize({ id: 'p3', name: 'Bike', stock: 50 })]} loading={false} {...fns} />);
    expect(screen.getAllByText('1,200').length).toBeGreaterThan(0);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    for (const name of ['published', 'mystery']) screen.getAllByRole('button', { name }).forEach((b) => fireEvent.click(b));
    screen.getAllByTitle('Edit').forEach((b) => fireEvent.click(b));
    screen.getAllByTitle('Delete').forEach((b) => fireEvent.click(b));
    const row = screen.getAllByText('Cap')[0].closest('tr')!;
    fireEvent.click(within(row).getAllByRole('button')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
    const card = screen.getAllByText('Cap')[1].closest('.p-4')!;
    const cardButtons = within(card as HTMLElement).getAllByRole('button');
    fireEvent.click(cardButtons[2]);
    fireEvent.click(cardButtons[3]);
    expect(fns.onToggleStatus).toHaveBeenCalledTimes(6);
    expect(fns.onToggleActive).toHaveBeenCalledTimes(2);
    expect(fns.onEdit).toHaveBeenCalledTimes(4);
    expect(fns.onDelete).toHaveBeenCalledTimes(4);
  });
});

describe('PrizeForm', () => {
  const setup = (p: Prize | null = null, isSubmitting = false) => {
    const props = { onSubmit: vi.fn().mockResolvedValue(undefined), onClose: vi.fn() };
    render(<PrizeForm prize={p} isSubmitting={isSubmitting} {...props} />);
    return props;
  };
  const urlInput = () => screen.getByPlaceholderText('Upload an image, or paste an image link');

  it('creates a prize with defaults', async () => {
    const p = setup();
    expect(screen.getByText('Create New Prize')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('e.g., iPhone 15 Pro'), { target: { value: 'Earbuds' } });
    fireEvent.click(screen.getByRole('button', { name: /Published/ }));
    fireEvent.click(screen.getByRole('button', { name: /Draft/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Prize' }));
    await waitFor(() => expect(p.onSubmit).toHaveBeenCalled());
    expect(p.onSubmit.mock.calls[0][0]).toMatchObject({ name: 'Earbuds', type: 'phone', category: 'general', pointsRequired: 100, status: 'draft', description: '', imageUrl: '', modelUrl: '' });
  });

  it('validates fields, including the image host', async () => {
    const p = setup();
    fireEvent.change(screen.getByPlaceholderText('e.g., iPhone 15 Pro'), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('100'), { target: { value: '0' } });
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '-1' } });
    fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '-2' } });
    fireEvent.change(screen.getByPlaceholderText('Brief description of the prize...'), { target: { value: 'x'.repeat(501) } });
    fireEvent.change(screen.getByPlaceholderText('https://example.com/model.glb'), { target: { value: 'nope' } });
    fireEvent.change(urlInput(), { target: { value: 'https://evil.example/a.png' } });
    fireEvent.submit(urlInput().closest('form')!);
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Points must be at least 1')).toBeInTheDocument();
    expect(screen.getByText('Value cannot be negative')).toBeInTheDocument();
    expect(screen.getByText('Stock cannot be negative')).toBeInTheDocument();
    expect(screen.getByText('Description too long')).toBeInTheDocument();
    expect(screen.getByText('Invalid URL')).toBeInTheDocument();
    expect(screen.getByText(/Supabase Storage/)).toBeInTheDocument();
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it('accepts a local /public image path', async () => {
    const p = setup();
    fireEvent.change(screen.getByPlaceholderText('e.g., iPhone 15 Pro'), { target: { value: 'Watch' } });
    fireEvent.change(urlInput(), { target: { value: '/prizes/watch.svg' } });
    fireEvent.submit(urlInput().closest('form')!);
    await waitFor(() => expect(p.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Watch', imageUrl: '/prizes/watch.svg' })));
    expect(screen.queryByText('Invalid URL')).toBeNull();
  });

  it('edits an existing prize, previews and uploads an image', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ url: `${CLD}/new.png` }))
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ error: 'The file could not be read as an image' }, 400))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.reject(new Error('not json')) });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = setup(prize({ description: null as unknown as string, modelUrl: null }));
    expect(screen.getByText('Edit Prize')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Preview' })).toBeInTheDocument();
    const file = screen.getByLabelText(/Upload/) as HTMLInputElement;
    fireEvent.change(file, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });
    await waitFor(() => expect(urlInput()).toHaveValue(`${CLD}/new.png`));
    // Sent to the prize-images bucket
    expect((fetchMock.mock.calls[0][1].body as FormData).get('target')).toBe('prize');
    fireEvent.change(file, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Upload failed'));
    expect(console.error).toHaveBeenCalledWith('Error uploading image:', expect.any(Error));
    fireEvent.change(file, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('The file could not be read as an image'));
    // A 200 without a usable body is still a failure
    fireEvent.change(file, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
    expect(h.toast.error).toHaveBeenLastCalledWith('Upload failed');
    fireEvent.change(file, { target: { files: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fireEvent.error(screen.getByRole('img', { name: 'Preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update Prize' }));
    await waitFor(() => expect(p.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Phone', imageUrl: `${CLD}/new.png` })));
  });

  it('closes from the backdrop, the X and Cancel, and shows saving', () => {
    const onClose = vi.fn();
    const { container } = render(<PrizeForm prize={null} isSubmitting onSubmit={vi.fn()} onClose={onClose} />);
    const p = { onClose };
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByText('Create New Prize').closest('.flex')!.querySelector('button')!);
    fireEvent.click(screen.getByText('Create New Prize'));
    expect(p.onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(container.firstElementChild!);
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });
});

describe('WalletFeatureToggle', () => {
  const settings = (value?: string, extra: Record<string, unknown> = {}) =>
    jsonResponse({ settings: value === undefined ? [] : [{ key: 'wallet_enabled', value, updatedAt: '2026-10-01T10:00:00Z', updatedBy: 'admin@x', ...extra }] });

  it('reads the setting and turns the wallet off', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/csrf-token') return jsonResponse({ csrfToken: 'tok' });
      if (init?.method === 'PUT') return jsonResponse({ setting: { updatedAt: '2026-10-02T10:00:00Z', updatedBy: null } });
      return settings('true');
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<WalletFeatureToggle />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText(/by admin@x/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/csrf-token'));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Wallet disabled — quizzes are now free for everyone.'));
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText(/Currently OFF/)).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(put[1]!.headers).toMatchObject({ 'x-csrf-token': 'tok' });
    expect(JSON.parse(put[1]!.body as string)).toEqual({ key: 'wallet_enabled', value: 'false' });
    expect(screen.queryByText(/ by /)).toBeNull();
  });

  it('turns it back on, and reverts when saving fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/csrf-token') throw new Error('no token');
      if (init?.method === 'PUT') return jsonResponse({ setting: {} });
      return settings('false');
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<WalletFeatureToggle />);
    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Wallet enabled — quizzes require the 2 PKR/24h payment again.'));
    expect(fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')![1]!.headers).not.toHaveProperty('x-csrf-token');

    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'Not allowed' }, 403));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Not allowed'));
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    fetchMock.mockImplementationOnce(async () => jsonResponse({}, 500));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to update setting'));
    fetchMock.mockImplementationOnce(async () => { throw 'odd'; });
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to update wallet setting'));
  });

  it('defaults to on when the setting is missing or unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/csrf-token' ? jsonResponse({ csrfToken: 't' }) : settings())));
    const { unmount } = render(<WalletFeatureToggle />);
    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    render(<WalletFeatureToggle />);
    expect(await screen.findByText('Enabled')).toBeInTheDocument();
  });
});

describe('DynamicAdminComponents', () => {
  it('lazy-loads each admin manager with a skeleton', async () => {
    expect(Object.keys(DynamicAdmin)).toHaveLength(5);
    expect(h.dynamics).toHaveLength(5);
    for (const d of h.dynamics) {
      await expect(d.loader()).resolves.toBeTruthy();
      const { container, unmount } = render(<>{d.opts.loading()}</>);
      expect(container.querySelector('.animate-pulse')).not.toBeNull();
      unmount();
    }
    await act(async () => {});
  });
});
