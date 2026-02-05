import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WinnerRow } from './WinnerRow';
import type { Winner } from './types';

const mockWinner: Winner = {
    userId: 'user-1',
    userName: 'John Doe',
    userEmail: 'john@example.com',
    score: 85,
    pointsAwarded: 10,
};

describe('WinnerRow', () => {
    it('renders winner information correctly', () => {
        render(
            <table>
                <tbody>
                    <WinnerRow winner={mockWinner} rank={1} />
                </tbody>
            </table>
        );

        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('john@example.com')).toBeInTheDocument();
        expect(screen.getByText('85%')).toBeInTheDocument();
        expect(screen.getByText('+10 pts')).toBeInTheDocument();
    });

    it('shows gold medal for rank 1', () => {
        render(
            <table>
                <tbody>
                    <WinnerRow winner={mockWinner} rank={1} />
                </tbody>
            </table>
        );

        expect(screen.getByText('🥇')).toBeInTheDocument();
    });

    it('shows silver medal for rank 2', () => {
        render(
            <table>
                <tbody>
                    <WinnerRow winner={mockWinner} rank={2} />
                </tbody>
            </table>
        );

        expect(screen.getByText('🥈')).toBeInTheDocument();
    });

    it('shows bronze medal for rank 3', () => {
        render(
            <table>
                <tbody>
                    <WinnerRow winner={mockWinner} rank={3} />
                </tbody>
            </table>
        );

        expect(screen.getByText('🥉')).toBeInTheDocument();
    });

    it('shows number rank for ranks above 3', () => {
        render(
            <table>
                <tbody>
                    <WinnerRow winner={mockWinner} rank={5} />
                </tbody>
            </table>
        );

        expect(screen.getByText('#5')).toBeInTheDocument();
    });

    it('shows Anonymous for winner without name', () => {
        const anonymousWinner: Winner = {
            ...mockWinner,
            userName: '',
        };

        render(
            <table>
                <tbody>
                    <WinnerRow winner={anonymousWinner} rank={1} />
                </tbody>
            </table>
        );

        expect(screen.getByText('Anonymous')).toBeInTheDocument();
    });
});
