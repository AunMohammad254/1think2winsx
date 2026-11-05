import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TransactionHistory from '@/components/wallet/TransactionHistory';
import { WalletTransaction } from '@/types/wallet';

const mockTransactions: WalletTransaction[] = [
    {
        id: '1',
        userId: 'user1',
        amount: 50,
        paymentMethod: 'Easypaisa',
        transactionId: 'trx1',
        status: 'approved',
        createdAt: '2023-10-26T10:00:00Z',
        updatedAt: '2023-10-26T10:00:00Z',
    },
    {
        id: '2',
        userId: 'user1',
        amount: 20,
        paymentMethod: 'Jazzcash',
        transactionId: 'trx2',
        status: 'pending',
        createdAt: '2023-10-25T10:00:00Z',
        updatedAt: '2023-10-25T10:00:00Z',
    },
    {
        id: '3',
        userId: 'user1',
        amount: 10,
        paymentMethod: 'Bank',
        transactionId: 'trx3',
        status: 'rejected',
        createdAt: '2023-10-24T10:00:00Z',
        updatedAt: '2023-10-24T10:00:00Z',
    },
    {
        id: '4',
        userId: 'user1',
        amount: 5,
        paymentMethod: 'QuizAccess',
        transactionId: 'quiz_access_1',
        status: 'approved',
        createdAt: '2023-10-23T10:00:00Z',
        updatedAt: '2023-10-23T10:00:00Z',
    },
    {
        id: '5',
        userId: 'user1',
        amount: -10, // deduction via negative amount
        paymentMethod: 'QuizAccess',
        transactionId: 'quiz_access_2',
        status: 'approved',
        createdAt: '2023-10-22T10:00:00Z',
        updatedAt: '2023-10-22T10:00:00Z',
    },
    {
        id: '6',
        userId: 'user1',
        amount: 15,
        paymentMethod: 'Easypaisa',
        transactionId: 'trx6',
        status: 'approved',
        createdAt: '2023-10-21T10:00:00Z',
        updatedAt: '2023-10-21T10:00:00Z',
    }
];

describe('TransactionHistory Component', () => {
    it('renders loading state when isLoading is true', () => {
        render(<TransactionHistory transactions={[]} isLoading={true} />);

        expect(screen.getByRole('status', { name: /loading transactions/i })).toBeInTheDocument();
        // The component renders multiple mock skeleton items, we check for the parent container by aria-label
    });

    it('renders empty state when there are no transactions', () => {
        render(<TransactionHistory transactions={[]} />);

        expect(screen.getByText('No Transactions')).toBeInTheDocument();
        expect(screen.getByText('Your transaction history will appear here')).toBeInTheDocument();
    });

    it('renders transactions correctly up to initialLimit', () => {
        render(<TransactionHistory transactions={mockTransactions} initialLimit={3} />);

        const listItems = screen.getAllByRole('listitem');
        expect(listItems).toHaveLength(3);

        // Check first item (approved deposit)
        const firstItem = listItems[0];
        expect(within(firstItem).getByText('Deposit')).toBeInTheDocument();
        expect(within(firstItem).getByText('Approved')).toBeInTheDocument();
        expect(within(firstItem).getByText('+50')).toBeInTheDocument();

        // Check second item (pending deposit)
        const secondItem = listItems[1];
        expect(within(secondItem).getByText('Deposit')).toBeInTheDocument();
        expect(within(secondItem).getByText('Pending')).toBeInTheDocument();
        expect(within(secondItem).getByText('20')).toBeInTheDocument(); // pending has no prefix

        // Check third item (rejected deposit)
        const thirdItem = listItems[2];
        expect(within(thirdItem).getByText('Deposit')).toBeInTheDocument();
        expect(within(thirdItem).getByText('Rejected')).toBeInTheDocument();
        expect(within(thirdItem).getByText('10')).toBeInTheDocument(); // rejected has no prefix
    });

    it('identifies deduction transactions correctly', () => {
        render(<TransactionHistory transactions={mockTransactions} initialLimit={5} />);

        const listItems = screen.getAllByRole('listitem');

        // 4th item (id: 4) is QuizAccess (deduction logic overrides because isQuizAccess is true)
        const fourthItem = listItems[3];
        expect(within(fourthItem).getByText('Quiz Access')).toBeInTheDocument();
        expect(within(fourthItem).getByText('Completed')).toBeInTheDocument();
        expect(within(fourthItem).getByText('-5')).toBeInTheDocument();

        // 5th item (id: 5) is amount < 0 (deduction)
        const fifthItem = listItems[4];
        expect(within(fifthItem).getByText('Quiz Access')).toBeInTheDocument();
        expect(within(fifthItem).getByText('Completed')).toBeInTheDocument();
        expect(within(fifthItem).getByText('-10')).toBeInTheDocument();
    });

    it('handles load more functionality', () => {
        render(<TransactionHistory transactions={mockTransactions} initialLimit={3} loadMoreCount={2} />);

        // Initial limit is 3
        expect(screen.getAllByRole('listitem')).toHaveLength(3);

        const loadMoreBtn = screen.getByRole('button', { name: /load 3 more transactions/i });
        expect(loadMoreBtn).toBeInTheDocument();

        // Click load more
        fireEvent.click(loadMoreBtn);

        // Limit increases by 2 -> 5
        expect(screen.getAllByRole('listitem')).toHaveLength(5);

        const loadMoreBtnAfter = screen.getByRole('button', { name: /load 1 more transactions/i });
        expect(loadMoreBtnAfter).toBeInTheDocument();

        // Click load more again
        fireEvent.click(loadMoreBtnAfter);

        // Limit increases by 2 -> 7 (but max is 6)
        expect(screen.getAllByRole('listitem')).toHaveLength(6);

        // Button should be gone
        expect(screen.queryByRole('button', { name: /load/i })).not.toBeInTheDocument();
    });
});
