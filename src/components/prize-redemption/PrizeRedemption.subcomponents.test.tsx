import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrizeCard } from './PrizeCard';
import { HistoryCard } from './HistoryCard';
import type { Prize, RedemptionHistory } from './types';

// Mock Next.js Image
vi.mock('next/image', () => ({
    default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

describe('PrizeRedemption sub-components', () => {
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
    });

    describe('HistoryCard', () => {
        const mockRedemption: RedemptionHistory = {
            id: 'redemption-1',
            status: 'pending',
            pointsUsed: 1000,
            requestedAt: '2026-05-20T10:00:00Z',
            prize: {
                name: 'Gaming Headset',
                description: 'High-quality gaming headset',
                imageUrl: '/headset.png',
                type: 'electronics',
            },
        };
        const mockOnPreview = vi.fn();

        it('renders redemption history correctly', () => {
            render(
                <HistoryCard 
                    redemption={mockRedemption} 
                    onPreview={mockOnPreview} 
                />
            );

            expect(screen.getByText('Gaming Headset')).toBeInTheDocument();
            expect(screen.getByText('High-quality gaming headset')).toBeInTheDocument();
            expect(screen.getByText('1000 points')).toBeInTheDocument();
            expect(screen.getByText('Pending')).toBeInTheDocument();
        });

        it('applies status color based on status', () => {
            const approvedRedemption = { ...mockRedemption, status: 'approved' as const };
            render(
                <HistoryCard 
                    redemption={approvedRedemption} 
                    onPreview={mockOnPreview} 
                />
            );

            const statusBadge = screen.getByText('Approved');
            // Check for blue text class used for approved
            expect(statusBadge).toHaveClass('text-blue-300');
        });

        it('renders notes if present', () => {
            const redemptionWithNotes = { ...mockRedemption, notes: 'Please send to my work address' };
            render(
                <HistoryCard 
                    redemption={redemptionWithNotes} 
                    onPreview={mockOnPreview} 
                />
            );

            expect(screen.getByText('Please send to my work address')).toBeInTheDocument();
        });

        it('calls onPreview when prize image is clicked', () => {
            const { container } = render(
                <HistoryCard 
                    redemption={mockRedemption} 
                    onPreview={mockOnPreview} 
                />
            );

            const imageContainer = container.querySelector('.h-16');
            if (imageContainer) {
                fireEvent.click(imageContainer);
                expect(mockOnPreview).toHaveBeenCalledWith(mockRedemption);
            }
        });
    });
});
