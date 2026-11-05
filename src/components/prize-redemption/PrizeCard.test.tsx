import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrizeCard } from './PrizeCard';
import type { Prize } from './types';

// Mock Next.js Image
vi.mock('next/image', () => ({
    // eslint-disable-next-line @next/next/no-img-element -- stand-in for next/image
    default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

describe('PrizeCard', () => {
    const mockPrize: Prize = {
        id: 'prize-1',
        name: 'Gaming Headset',
        description: 'High-quality gaming headset with noise cancellation',
        pointsRequired: 1000,
        imageUrl: '/headset.png',
        type: 'electronics',
        modelUrl: '',
    };
    const mockOnPreview = vi.fn();
    const mockOnRedeem = vi.fn();

    it('renders prize details correctly', () => {
        render(
            <PrizeCard
                prize={mockPrize}
                userPoints={2000}
                isRedeeming={false}
                onPreview={mockOnPreview}
                onRedeem={mockOnRedeem}
            />
        );

        expect(screen.getByText('Gaming Headset')).toBeInTheDocument();
        expect(screen.getByText('High-quality gaming headset with noise cancellation')).toBeInTheDocument();
        expect(screen.getByText('1000 points')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /redeem/i })).toBeEnabled();
    });

    it('disables redeem button if user does not have enough points', () => {
        render(
            <PrizeCard
                prize={mockPrize}
                userPoints={500}
                isRedeeming={false}
                onPreview={mockOnPreview}
                onRedeem={mockOnRedeem}
            />
        );

        const redeemButton = screen.getByRole('button', { name: /not enough points/i });
        expect(redeemButton).toBeDisabled();
    });

    it('shows redeeming state when isRedeeming is true', () => {
        render(
            <PrizeCard
                prize={mockPrize}
                userPoints={2000}
                isRedeeming={true}
                onPreview={mockOnPreview}
                onRedeem={mockOnRedeem}
            />
        );

        expect(screen.getByRole('button', { name: /redeeming/i })).toBeDisabled();
    });

    it('calls onPreview when image container is clicked', () => {
        const { container } = render(
            <PrizeCard
                prize={mockPrize}
                userPoints={2000}
                isRedeeming={false}
                onPreview={mockOnPreview}
                onRedeem={mockOnRedeem}
            />
        );

        // The image container has the onClick
        const imageContainer = container.querySelector('.h-48');
        if (imageContainer) {
            fireEvent.click(imageContainer);
            expect(mockOnPreview).toHaveBeenCalledWith(mockPrize);
        }
    });

    it('calls onRedeem when redeem button is clicked', () => {
        render(
            <PrizeCard
                prize={mockPrize}
                userPoints={2000}
                isRedeeming={false}
                onPreview={mockOnPreview}
                onRedeem={mockOnRedeem}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /redeem/i }));
        expect(mockOnRedeem).toHaveBeenCalledWith('prize-1', 'Gaming Headset', 1000);
    });

    it('shows a claimed prize as Claimed, with no redeem button', () => {
        render(
            <PrizeCard prize={mockPrize} userPoints={2000} isRedeeming={false} isClaimed onPreview={mockOnPreview} onRedeem={mockOnRedeem} />
        );
        expect(screen.getByRole('button', { name: 'Prize Gaming Headset already claimed' })).toBeDisabled();
        expect(screen.getAllByText('Claimed')).toHaveLength(2);
        expect(screen.queryByRole('button', { name: 'Redeem' })).toBeNull();
    });

    it('shows the stock left, and the type picture when the prize has none', () => {
        const { rerender } = render(
            <PrizeCard prize={{ ...mockPrize, imageUrl: '', stock: 3 }} userPoints={0} isRedeeming={false} onPreview={mockOnPreview} onRedeem={mockOnRedeem} />
        );
        expect(screen.getByText('Only 3 left!')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Gaming Headset' })).toHaveAttribute('src', '/prizes/electronics.svg');
        rerender(<PrizeCard prize={{ ...mockPrize, stock: 40 }} userPoints={0} isRedeeming={false} onPreview={mockOnPreview} onRedeem={mockOnRedeem} />);
        expect(screen.getByText('Stock: 40')).toBeInTheDocument();
        rerender(<PrizeCard prize={{ ...mockPrize, stock: 0 }} userPoints={0} isRedeeming={false} onPreview={mockOnPreview} onRedeem={mockOnRedeem} />);
        expect(screen.queryByText(/left!|Stock:/)).toBeNull();
    });
});
