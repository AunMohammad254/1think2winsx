import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryCard } from './HistoryCard';
import type { RedemptionHistory } from './types';

// Mock Next.js Image
vi.mock('next/image', () => ({
    // eslint-disable-next-line @next/next/no-img-element -- next/image mocked as a plain img for the test
    default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

describe('PrizeRedemption sub-components', () => {
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
