import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatsGrid from '@/components/profile/StatsGrid';

describe('StatsGrid', () => {
    it('renders empty list gracefully', () => {
        render(<StatsGrid stats={[]} />);
        expect(screen.getByRole('list', { name: 'Profile statistics' })).toBeInTheDocument();
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });

    it('renders multiple stats with correct labels, values, and icons', () => {
        const stats = [
            { id: '1', label: 'Quizzes', value: 3, icon: <span data-testid="icon-1">📝</span> },
            { id: '2', label: 'Wins', value: '1', icon: <span data-testid="icon-2">🏆</span> },
        ];
        render(<StatsGrid stats={stats} />);

        expect(screen.getByRole('list', { name: 'Profile statistics' })).toBeInTheDocument();
        expect(screen.getAllByRole('listitem')).toHaveLength(2);

        expect(screen.getByRole('listitem', { name: 'Quizzes: 3' })).toBeInTheDocument();
        expect(screen.getByRole('listitem', { name: 'Wins: 1' })).toBeInTheDocument();

        expect(screen.getByText('Quizzes')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByTestId('icon-1')).toBeInTheDocument();

        expect(screen.getByText('Wins')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByTestId('icon-2')).toBeInTheDocument();
    });

    it('applies custom gradient when provided, otherwise uses default background', () => {
        const stats = [
            { id: '1', label: 'Default', value: 0, icon: <span /> },
            { id: '2', label: 'Custom', value: 1, icon: <span />, gradient: 'bg-gold' },
        ];
        render(<StatsGrid stats={stats} />);

        const defaultItem = screen.getByRole('listitem', { name: 'Default: 0' });
        expect(defaultItem.className).toContain('bg-white/5');
        expect(defaultItem.className).not.toContain('bg-gold');

        const customItem = screen.getByRole('listitem', { name: 'Custom: 1' });
        expect(customItem.className).toContain('bg-gold');
        expect(customItem.className).not.toContain('bg-white/5');
    });

    it('has appropriate accessibility attributes', () => {
        const stats = [
            { id: '1', label: 'Quizzes', value: 3, icon: <span /> },
        ];
        render(<StatsGrid stats={stats} />);

        const list = screen.getByRole('list', { name: 'Profile statistics' });
        expect(list).toBeInTheDocument();

        const listItem = screen.getByRole('listitem', { name: 'Quizzes: 3' });
        expect(listItem).toBeInTheDocument();
        expect(listItem).toHaveAttribute('tabIndex', '0');

        // icon wrapper has aria-hidden
        const iconWrapper = listItem.querySelector('div[aria-hidden="true"]');
        expect(iconWrapper).toBeInTheDocument();
    });
});
