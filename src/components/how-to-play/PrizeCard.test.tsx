import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PrizeCard from './PrizeCard';
import { Trophy } from 'lucide-react';

// Mock framer-motion
vi.mock('framer-motion', () => ({
    motion: {
        // Drops the animation props, which aren't DOM attributes
        div: ({ initial: _initial, whileInView: _whileInView, viewport: _viewport, transition: _transition, whileHover: _whileHover, ...props }: any) => <div {...props} />
    }
}));

describe('PrizeCard', () => {
    const mockProps = {
        name: 'Test Grand Prize',
        description: 'A test description',
        icon: Trophy,
        tier: 'grand' as const
    };

    it('renders the grand prize correctly', () => {
        render(<PrizeCard {...mockProps} />);

        expect(screen.getByText('Test Grand Prize')).toBeInTheDocument();
        expect(screen.getByText('A test description')).toBeInTheDocument();
        expect(screen.getByText('🏆 GRAND PRIZE')).toBeInTheDocument();
    });

    it('renders standard tier correctly', () => {
        render(<PrizeCard {...mockProps} tier="standard" name="Standard Prize" />);

        expect(screen.getByText('Standard Prize')).toBeInTheDocument();
        // Grand prize badge shouldn't be here
        expect(screen.queryByText('🏆 GRAND PRIZE')).not.toBeInTheDocument();
    });

    it('renders major tier correctly', () => {
        render(<PrizeCard {...mockProps} tier="major" name="Major Prize" />);

        expect(screen.getByText('Major Prize')).toBeInTheDocument();
        // Grand prize badge shouldn't be here
        expect(screen.queryByText('🏆 GRAND PRIZE')).not.toBeInTheDocument();
    });
});
