import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PrizeCard from './PrizeCard';
import type { Prize } from '@/types/prize';

// Mock next/image
vi.mock('next/image', () => ({
    // eslint-disable-next-line @next/next/no-img-element -- stand-in for next/image
    default: ({ fill: _fill, blurDataURL: _blurDataURL, sizes: _sizes, onError, ...props }: any) => <img onError={onError} {...props} />
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
    motion: {
        // Drops the animation props, which aren't DOM attributes
        div: ({ initial: _initial, animate: _animate, transition: _transition, whileHover: _whileHover, ...props }: any) => <div {...props} />
    }
}));

describe('PrizeCard', () => {
    const mockPrize: Prize = {
        id: '1',
        name: 'Test Prize',
        description: 'Test Description',
        imageUrl: '/test-image.jpg',
        modelUrl: null,
        type: 'test-type',
        pointsRequired: 1000,
        isActive: true,
        category: 'electronics',
        stock: 5,
        status: 'published',
        value: 100,
        createdAt: new Date(),
        updatedAt: new Date()
    };

    it('renders the prize details correctly', () => {
        render(<PrizeCard prize={mockPrize} />);

        expect(screen.getByText('Test Prize')).toBeInTheDocument();
        expect(screen.getByText('Test Description')).toBeInTheDocument();
        expect(screen.getByText('1,000')).toBeInTheDocument();
        expect(screen.getByText('Only 5 left!')).toBeInTheDocument();
        expect(screen.getByText('Electronics')).toBeInTheDocument();
    });

    it('shows out of stock message when stock is 0', () => {
        const outOfStockPrize = { ...mockPrize, stock: 0 };
        render(<PrizeCard prize={outOfStockPrize} />);

        expect(screen.getAllByText('Out of Stock')).toHaveLength(2); // One in badge, one in button
    });

    it('handles claim state correctly', () => {
        render(<PrizeCard prize={mockPrize} isClaimed={true} />);

        expect(screen.getAllByText('Claimed')).toHaveLength(2); // One in badge, one in button
        const button = screen.getByRole('button');
        expect(button).toBeDisabled();
    });

    it('disables button when user has insufficient points', () => {
        render(<PrizeCard prize={mockPrize} userPoints={500} />);

        const button = screen.getByRole('button');
        expect(button).toBeDisabled();
        expect(screen.getByText('Need 500 more points')).toBeInTheDocument();
    });

    it('enables button and handles click when user can redeem', () => {
        const mockOnRedeem = vi.fn();
        render(
            <PrizeCard
                prize={mockPrize}
                userPoints={2000}
                onRedeem={mockOnRedeem}
            />
        );

        const button = screen.getByRole('button');
        expect(button).not.toBeDisabled();
        expect(screen.getByText(/Redeem Now/)).toBeInTheDocument();

        fireEvent.click(button);
        expect(mockOnRedeem).toHaveBeenCalledWith(mockPrize);
    });

    it('shows processing state when redeeming', () => {
        render(<PrizeCard prize={mockPrize} userPoints={2000} isRedeeming={true} />);

        const button = screen.getByRole('button');
        expect(button).toBeDisabled();
        expect(screen.getByText('Processing...')).toBeInTheDocument();
    });

    it('handles image load error', () => {
        render(<PrizeCard prize={mockPrize} />);

        const image = screen.getByRole('img');
        fireEvent.error(image);

        // After error, it should show the fallback emoji instead of the image
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getAllByText('🎁').length).toBeGreaterThan(0);
    });

    it('renders with variants correctly', () => {
        render(<PrizeCard prize={mockPrize} variant="featured" />);
        expect(screen.getByText('Test Prize')).toBeInTheDocument();
        // Since we're just checking that variant props don't break rendering,
        // this basic test is sufficient to cover the branches in the component
    });

    it('displays full stock message when stock > 5', () => {
        const fullStockPrize = { ...mockPrize, stock: 10 };
        render(<PrizeCard prize={fullStockPrize} />);

        expect(screen.getByText('Stock: 10 left')).toBeInTheDocument();
    });

    it('uses general category colors if category is missing/unknown', () => {
        const unknownCategoryPrize = { ...mockPrize, category: 'unknown' as any };
        render(<PrizeCard prize={unknownCategoryPrize} />);

        expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('renders without prize description', () => {
        const noDescPrize = { ...mockPrize, description: null };
        render(<PrizeCard prize={noDescPrize} />);

        expect(screen.queryByText('Test Description')).not.toBeInTheDocument();
    });

    it('renders without image URL', () => {
        const noImagePrize = { ...mockPrize, imageUrl: null };
        render(<PrizeCard prize={noImagePrize} />);

        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getAllByText('🎁').length).toBeGreaterThan(0);
    });
});
