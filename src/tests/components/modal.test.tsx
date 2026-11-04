import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Modal } from '@/components/ui/modal';

// Radix starts listening for clicks outside one tick after the dialog opens
const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

afterEach(() => vi.restoreAllMocks());

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(<Modal open={false} onClose={vi.fn()} title="Delivery details">body</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('body')).toBeNull();
  });

  it('opens in <body>, outside the page, named by its title and described by its description, with focus inside', async () => {
    const { container } = render(
      <div className="backdrop-blur-xl overflow-hidden">
        <Modal open onClose={vi.fn()} title="Delivery details for Bike" description="1st place in “Cricket night”." icon={<span data-testid="icon" />} closeLabel="Close delivery details" className="max-w-lg">
          <input aria-label="Full name" />
        </Modal>
      </div>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delivery details for Bike' });
    expect(container).not.toContainElement(dialog);
    expect(dialog.parentElement!.parentElement).toBe(document.body);
    expect(dialog).toHaveAccessibleDescription('1st place in “Cricket night”.');
    expect(dialog).toHaveClass('max-w-lg');
    expect(within(dialog).getByTestId('icon')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Full name')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close delivery details' })).toHaveFocus());
  });

  it('has no description reference without a description, and a plain Close label by default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Modal open onClose={vi.fn()} title="Prize Details">body</Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Prize Details' });
    expect(dialog).not.toHaveAttribute('aria-describedby');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('closes from the X, Escape and a click outside', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Prize Details">body</Modal>);
    const dialog = screen.getByRole('dialog');
    await tick();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.pointerDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.pointerDown(within(dialog).getByText('body'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('stays open while it is not dismissible', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Delivery details" dismissible={false}>body</Modal>);
    const dialog = screen.getByRole('dialog');
    await tick();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.pointerDown(dialog.parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
