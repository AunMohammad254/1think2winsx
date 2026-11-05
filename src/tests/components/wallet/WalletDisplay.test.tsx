import { render, screen } from '@testing-library/react';
import WalletDisplay from '@/components/wallet/WalletDisplay';
import { describe, it, expect } from 'vitest';

describe('WalletDisplay', () => {
    it('displays the balance correctly', () => {
        render(<WalletDisplay balance={123.45} />);
        expect(screen.getByText('123.45')).toBeInTheDocument();
        expect(screen.getByText('PKR')).toBeInTheDocument();
        expect(screen.getByText(/No pending transactions/)).toBeInTheDocument(); // sr-only fallback
    });

    it('shows pending deposits and deductions', () => {
        render(<WalletDisplay balance={100} pendingDeposits={10} pendingDeductions={5} />);
        // 10 + 5 = 15 pending
        expect(screen.getAllByText(/15 pending/)).toHaveLength(2); // One visible, one sr-only
        expect(screen.getByLabelText('15 pending transactions')).toBeInTheDocument();
    });

    it('displays loading state correctly', () => {
        const { container } = render(<WalletDisplay balance={100} isLoading={true} />);
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
        // The balance text should not be present when loading
        expect(screen.queryByText('100.00')).not.toBeInTheDocument();
    });

    it('displays tip text', () => {
        render(<WalletDisplay balance={50} />);
        expect(screen.getByText('Deposit funds to play quizzes and win prizes.')).toBeInTheDocument();
    });

    it('shows status badges', () => {
        render(<WalletDisplay balance={50} />);
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('handles negative pending transactions correctly', () => {
        // Just to cover `hasPending` becoming false if deductions are negative and deposits are 0 etc.
        render(<WalletDisplay balance={50} pendingDeposits={0} pendingDeductions={0} />);
        expect(screen.queryByText(/0 pending/)).not.toBeInTheDocument();
        expect(screen.getByText(/No pending transactions/)).toBeInTheDocument(); // sr-only fallback
    });
});
