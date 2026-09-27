import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from './StatCard';

describe('StatCard', () => {
    it('renders with icon, label, and value', () => {
        render(<StatCard icon="📝" label="Total Questions" value={10} color="blue" />);

        expect(screen.getByText('📝')).toBeInTheDocument();
        expect(screen.getByText('Total Questions')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
    });

    it('renders string values correctly', () => {
        render(<StatCard icon="🏆" label="Status" value="Active" color="green" />);

        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('applies bounce animation when animate is true', () => {
        const { container } = render(
            <StatCard icon="⏳" label="Pending" value={5} color="yellow" animate={true} />
        );

        // Check for animate-bounce class on icon container
        const animatedElement = container.querySelector('.animate-bounce');
        expect(animatedElement).toBeInTheDocument();
    });

    it('applies correct color classes', () => {
        const { container } = render(
            <StatCard icon="📊" label="Stats" value={100} color="purple" />
        );

        // Should have purple-related gradient classes
        const card = container.firstChild;
        expect(card).toHaveClass('from-purple-500/20');
    });
});
