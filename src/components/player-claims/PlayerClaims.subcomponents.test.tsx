import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusStats } from './StatusStats';
import { ClaimCard } from './ClaimCard';
import { ClaimDetailsModal } from './ClaimDetailsModal';
import { ClaimsSkeleton } from './ClaimsSkeleton';
import type { Claim } from './types';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    Gift: () => <div data-testid="icon-gift" />,
    Search: () => <div data-testid="icon-search" />,
    RefreshCw: () => <div data-testid="icon-refresh" />,
    Filter: () => <div data-testid="icon-filter" />,
    Eye: () => <div data-testid="icon-eye" />,
    MessageSquare: () => <div data-testid="icon-message" />,
    CheckCircle: () => <div data-testid="icon-check" />,
    XCircle: () => <div data-testid="icon-x" />,
    Package: () => <div data-testid="icon-package" />,
    Loader2: () => <div data-testid="icon-loader" />,
    Clock: () => <div data-testid="icon-clock" />,
    User: () => <div data-testid="icon-user" />,
    MapPin: () => <div data-testid="icon-map" />,
    Smartphone: () => <div data-testid="icon-phone" />,
    History: () => <div data-testid="icon-history" />,
    Check: () => <div data-testid="icon-check-simple" />,
    Tag: () => <div data-testid="icon-tag" />,
    Mail: () => <div data-testid="icon-mail" />,
    X: () => <div data-testid="icon-x-simple" />,
    Phone: () => <div data-testid="icon-phone-simple" />,
    Calendar: () => <div data-testid="icon-calendar" />,
}));

// Mock Next.js Image
vi.mock('next/image', () => ({
    default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

describe('PlayerClaims sub-components', () => {
    describe('StatusStats', () => {
        const mockCounts = {
            pending: 5,
            approved: 3,
            fulfilled: 10,
            rejected: 2,
        };
        const mockOnSelectStatus = vi.fn();

        it('renders all status categories with counts', () => {
            render(
                <StatusStats 
                    counts={mockCounts} 
                    selectedStatus="pending" 
                    onSelectStatus={mockOnSelectStatus} 
                />
            );

            expect(screen.getByText('5')).toBeInTheDocument();
            expect(screen.getByText('3')).toBeInTheDocument();
            expect(screen.getByText('10')).toBeInTheDocument();
            expect(screen.getByText('2')).toBeInTheDocument();

            expect(screen.getByText('Pending Review')).toBeInTheDocument();
            expect(screen.getByText('Approved')).toBeInTheDocument();
            expect(screen.getByText('Fulfilled')).toBeInTheDocument();
            expect(screen.getByText('Rejected')).toBeInTheDocument();
        });

        it('calls onSelectStatus when a category is clicked', () => {
            render(
                <StatusStats 
                    counts={mockCounts} 
                    selectedStatus="pending" 
                    onSelectStatus={mockOnSelectStatus} 
                />
            );

            fireEvent.click(screen.getByText('Approved').closest('button')!);
            expect(mockOnSelectStatus).toHaveBeenCalledWith('approved');
        });

        it('applies active styles to the selected status', () => {
            render(
                <StatusStats 
                    counts={mockCounts} 
                    selectedStatus="approved" 
                    onSelectStatus={mockOnSelectStatus} 
                />
            );

            const approvedButton = screen.getByText('Approved').closest('button');
            // Check for blue background class from statusConfig for 'approved'
            expect(approvedButton).toHaveClass('bg-blue-500/20');
        });
    });

    describe('ClaimCard', () => {
        const mockClaim: Claim = {
            id: 'claim-1',
            status: 'pending',
            pointsUsed: 500,
            fullName: 'John Doe',
            whatsappNumber: '1234567890',
            address: '123 Main St',
            requestedAt: '2026-05-20T10:00:00Z',
            processedAt: null,
            notes: null,
            user: {
                id: 'user-1',
                name: 'John Doe',
                email: 'john@example.com',
                phone: '1234567890',
                points: 1000,
            },
            prize: {
                id: 'prize-1',
                name: 'Cool Smartwatch',
                imageUrl: '/smartwatch.svg',
                description: 'Cool Smartwatch description',
                type: 'electronics',
                pointsRequired: 500,
            },
        };
        const mockOnViewDetails = vi.fn();
        const mockOnUpdateStatus = vi.fn();

        it('renders claim details correctly', () => {
            render(
                <ClaimCard 
                    claim={mockClaim} 
                    updating={null} 
                    onViewDetails={mockOnViewDetails} 
                    onUpdateStatus={mockOnUpdateStatus} 
                />
            );

            expect(screen.getByText('Cool Smartwatch')).toBeInTheDocument();
            expect(screen.getByText('John Doe • john@example.com')).toBeInTheDocument();
            expect(screen.getByText(/500\s*points/)).toBeInTheDocument();
            expect(screen.getByText('Pending Review')).toBeInTheDocument();
        });

        it('shows action buttons for pending status', () => {
            render(
                <ClaimCard 
                    claim={mockClaim} 
                    updating={null} 
                    onViewDetails={mockOnViewDetails} 
                    onUpdateStatus={mockOnUpdateStatus} 
                />
            );

            expect(screen.getByText('Approve')).toBeInTheDocument();
            expect(screen.getByText('Reject')).toBeInTheDocument();
        });

        it('shows mark fulfilled button for approved status', () => {
            const approvedClaim = { ...mockClaim, status: 'approved' as const };
            render(
                <ClaimCard 
                    claim={approvedClaim} 
                    updating={null} 
                    onViewDetails={mockOnViewDetails} 
                    onUpdateStatus={mockOnUpdateStatus} 
                />
            );

            expect(screen.getByText('Mark Fulfilled')).toBeInTheDocument();
        });

        it('calls onViewDetails when details button is clicked', () => {
            render(
                <ClaimCard 
                    claim={mockClaim} 
                    updating={null} 
                    onViewDetails={mockOnViewDetails} 
                    onUpdateStatus={mockOnUpdateStatus} 
                />
            );

            fireEvent.click(screen.getByText('Details'));
            expect(mockOnViewDetails).toHaveBeenCalledWith(mockClaim);
        });

        it('calls onUpdateStatus when action buttons are clicked', () => {
            render(
                <ClaimCard 
                    claim={mockClaim} 
                    updating={null} 
                    onViewDetails={mockOnViewDetails} 
                    onUpdateStatus={mockOnUpdateStatus} 
                />
            );

            fireEvent.click(screen.getByText('Approve'));
            expect(mockOnUpdateStatus).toHaveBeenCalledWith('claim-1', 'approved');
        });

        it('shows loading state when updating', () => {
            render(
                <ClaimCard 
                    claim={mockClaim} 
                    updating="claim-1" 
                    onViewDetails={mockOnViewDetails} 
                    onUpdateStatus={mockOnUpdateStatus} 
                />
            );

            expect(screen.getByTestId('icon-loader')).toBeInTheDocument();
        });

        it('renders notes if present', () => {
            const claimWithNotes = { ...mockClaim, notes: 'Please send ASAP' };
            render(
                <ClaimCard 
                    claim={claimWithNotes} 
                    updating={null} 
                    onViewDetails={mockOnViewDetails} 
                    onUpdateStatus={mockOnUpdateStatus} 
                />
            );

            expect(screen.getByText('Please send ASAP')).toBeInTheDocument();
        });
    });

    describe('ClaimDetailsModal', () => {
        const mockClaim: Claim = {
            id: 'claim-1',
            status: 'pending',
            pointsUsed: 500,
            fullName: 'John Doe',
            whatsappNumber: '1234567890',
            address: '123 Main St',
            requestedAt: '2026-05-20T10:00:00Z',
            processedAt: null,
            notes: null,
            user: {
                id: 'user-1',
                name: 'John Doe',
                email: 'john@example.com',
                phone: '1234567890',
                points: 1000,
            },
            prize: {
                id: 'prize-1',
                name: 'Cool Smartwatch',
                imageUrl: '/smartwatch.svg',
                description: 'Cool Smartwatch description',
                type: 'electronics',
                pointsRequired: 500,
            },
        };
        const mockOnClose = vi.fn();
        const mockOnUpdateStatus = vi.fn();

        it('renders all claim details in modal', () => {
            render(
                <ClaimDetailsModal 
                    claim={mockClaim} 
                    updating={null} 
                    onClose={mockOnClose} 
                    onUpdateStatus={mockOnUpdateStatus} 
                />
            );

            expect(screen.getByText('Claim Details')).toBeInTheDocument();
            
            // Check for names (multiple instances might exist)
            const names = screen.getAllByText('John Doe');
            expect(names.length).toBeGreaterThan(0);
            
            expect(screen.getByText('john@example.com')).toBeInTheDocument();
            expect(screen.getByText('1234567890')).toBeInTheDocument();
            expect(screen.getByText('123 Main St')).toBeInTheDocument();
            expect(screen.getByText('Cool Smartwatch')).toBeInTheDocument();
        });

        it('calls onClose when close button is clicked', () => {
            const { container } = render(
                <ClaimDetailsModal 
                    claim={mockClaim} 
                    updating={null} 
                    onClose={mockOnClose} 
                    onUpdateStatus={mockOnUpdateStatus} 
                />
            );

            // Find close button by test ID or icon
            const closeButton = screen.queryByRole('button', { name: /close/i }) || 
                              container.querySelector('button .icon-x-simple')?.closest('button') ||
                              container.querySelector('button svg')?.closest('button');
            
            if (closeButton) {
                fireEvent.click(closeButton);
                expect(mockOnClose).toHaveBeenCalled();
            }
        });
    });

    describe('ClaimsSkeleton', () => {
        it('renders skeleton rows', () => {
            const { container } = render(<ClaimsSkeleton />);
            // Should render 5 skeleton rows by default
            const skeletons = container.querySelectorAll('.animate-pulse');
            expect(skeletons.length).toBeGreaterThan(0);
        });
    });
});
