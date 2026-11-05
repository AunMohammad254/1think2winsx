import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ConfirmationModal from './ConfirmationModal';

describe('ConfirmationModal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        walletBalance: 1000,
        accessPrice: 200,
        paymentLoading: false,
        handleConfirmedPayment: vi.fn(),
        onBack: vi.fn(),
    };

    it('should return null when isOpen is false', () => {
        const { container } = render(<ConfirmationModal {...defaultProps} isOpen={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('should render correctly with formatted balances when isOpen is true', () => {
        render(<ConfirmationModal {...defaultProps} />);

        expect(screen.getByRole('heading', { name: 'Confirm Payment' })).toBeInTheDocument();
        expect(screen.getByText('Current Balance')).toBeInTheDocument();
        expect(screen.getByText('1000.00 PKR')).toBeInTheDocument();
        expect(screen.getByText('Amount to Deduct')).toBeInTheDocument();
        expect(screen.getByText('- 200.00 PKR')).toBeInTheDocument();
        expect(screen.getByText('Remaining Balance')).toBeInTheDocument();
        expect(screen.getByText('800.00 PKR')).toBeInTheDocument();
    });

    it('should show "Processing..." and disable the confirm button when paymentLoading is true', () => {
        const { container } = render(<ConfirmationModal {...defaultProps} paymentLoading={true} />);

        const confirmButton = screen.getByRole('button', { name: /processing/i });
        expect(confirmButton).toBeDisabled();
        expect(screen.getByText('Processing...')).toBeInTheDocument();
        // Check for animate-spin element
        expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('should call onClose when the close button is clicked', async () => {
        const onCloseMock = vi.fn();
        render(<ConfirmationModal {...defaultProps} onClose={onCloseMock} />);

        const closeButton = screen.getByText('×');
        await userEvent.click(closeButton);

        expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('should call onBack when the Back button is clicked', async () => {
        const onBackMock = vi.fn();
        render(<ConfirmationModal {...defaultProps} onBack={onBackMock} />);

        const backButton = screen.getByRole('button', { name: /back/i });
        await userEvent.click(backButton);

        expect(onBackMock).toHaveBeenCalledTimes(1);
    });

    it('should call handleConfirmedPayment when the Confirm Payment button is clicked', async () => {
        const handleConfirmedPaymentMock = vi.fn();
        render(<ConfirmationModal {...defaultProps} handleConfirmedPayment={handleConfirmedPaymentMock} />);

        const confirmButton = screen.getByRole('button', { name: /confirm payment/i });
        await userEvent.click(confirmButton);

        expect(handleConfirmedPaymentMock).toHaveBeenCalledTimes(1);
    });
});
