import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BalanceCard from '@/components/profile/BalanceCard';

describe('BalanceCard', () => {
    it('renders the total balance and default currency correctly', () => {
        render(<BalanceCard balance={150.75} />);

        // Check for static text
        expect(screen.getByText('Total Balance')).toBeInTheDocument();

        // Check for formatted balance and currency
        expect(screen.getByText('150.75')).toBeInTheDocument();
        expect(screen.getByText('PKR')).toBeInTheDocument();

        // Check for accessible text
        expect(screen.getByText('Current wallet balance: 150.75 PKR.')).toBeInTheDocument();
    });

    it('renders with a custom currency', () => {
        render(<BalanceCard balance={200} currency="USD" />);

        expect(screen.getByText('200.00')).toBeInTheDocument();
        expect(screen.getByText('USD')).toBeInTheDocument();
        expect(screen.getByText('Current wallet balance: 200.00 USD.')).toBeInTheDocument();
    });

    it('renders a loading skeleton when isLoading is true', () => {
        render(<BalanceCard balance={100} isLoading={true} />);

        // In loading state, the literal balance text shouldn't be rendered in the main display
        expect(screen.queryByText('100.00')).not.toBeInTheDocument();

        // Find the loading skeleton element (has role="status")
        const statusElement = screen.getByRole('status');
        expect(statusElement).toBeInTheDocument();
        expect(statusElement).toHaveClass('flex', 'items-center', 'justify-center', 'gap-2');

        // Find the inner animating div
        const pulseDiv = statusElement.querySelector('.animate-pulse');
        expect(pulseDiv).toBeInTheDocument();

        // The accessible text should still be present
        expect(screen.getByText('Current wallet balance: 100.00 PKR.')).toBeInTheDocument();
    });

    it('formats integer balances with 2 decimal places', () => {
        render(<BalanceCard balance={50} />);
        expect(screen.getByText('50.00')).toBeInTheDocument();
    });
});
