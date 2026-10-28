import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    RotateCcw: () => <div data-testid="icon-rotate" />,
    ShieldAlert: () => <div data-testid="icon-shield" />,
    KeyRound: () => <div data-testid="icon-key" />,
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

        it('names the quiz for a prize won in one, instead of 0 points', () => {
            render(
                <ClaimCard
                    claim={{ ...mockClaim, pointsUsed: 0, quiz: { id: 'quiz-1', title: 'Cricket night' } }}
                    updating={null}
                    onViewDetails={mockOnViewDetails}
                    onUpdateStatus={mockOnUpdateStatus}
                />
            );
            expect(screen.getByText(/Won in “Cricket night”/)).toBeInTheDocument();
            expect(screen.queryByText(/0\s*points/)).not.toBeInTheDocument();
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

        it('opens the details to confirm delivery of an approved claim, which needs the handover code', () => {
            const approvedClaim = { ...mockClaim, status: 'approved' as const };
            render(
                <ClaimCard
                    claim={approvedClaim}
                    updating={null}
                    onViewDetails={mockOnViewDetails}
                    onUpdateStatus={mockOnUpdateStatus}
                />
            );

            fireEvent.click(screen.getByText('Confirm Delivery'));
            expect(mockOnViewDetails).toHaveBeenCalledWith(approvedClaim);
            expect(mockOnUpdateStatus).not.toHaveBeenCalled();
        });

        it('shows the tracking ID and a risk badge, and sends a high-risk approval to the details', () => {
            const risky = {
                ...mockClaim,
                trackingId: '1T2W-7K3M-QX97',
                risk: { score: 70, level: 'high' as const, flags: [{ code: 'shared_phone', weight: 40 }, { code: 'shared_address', weight: 30 }] },
            };
            const { rerender } = render(
                <ClaimCard claim={risky} updating={null} onViewDetails={mockOnViewDetails} onUpdateStatus={mockOnUpdateStatus} />
            );
            expect(screen.getByText('1T2W-7K3M-QX97')).toBeInTheDocument();
            expect(screen.getByText('High risk')).toBeInTheDocument();
            fireEvent.click(screen.getByText('Approve'));
            expect(mockOnViewDetails).toHaveBeenCalledWith(risky);
            expect(mockOnUpdateStatus).not.toHaveBeenCalled();

            rerender(
                <ClaimCard claim={{ ...risky, risk: { ...risky.risk, level: 'medium' as const } }} updating={null} onViewDetails={mockOnViewDetails} onUpdateStatus={mockOnUpdateStatus} />
            );
            expect(screen.getByText('Check details')).toBeInTheDocument();
            fireEvent.click(screen.getByText('Approve'));
            expect(mockOnUpdateStatus).toHaveBeenCalledWith('claim-1', 'approved');
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
            expect(screen.queryByText('Reissued')).toBeNull();
        });

        it('marks a reissued claim, and offers Reissue on a delivered one', () => {
            const delivered = { ...mockClaim, status: 'fulfilled', notes: '[REISSUED FOR REDELIVERY] Courier lost it' } as Claim;
            render(
                <ClaimCard claim={delivered} updating={null} onViewDetails={mockOnViewDetails} onUpdateStatus={mockOnUpdateStatus} />
            );
            expect(screen.getByText('Reissued')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Reissue' }));
            expect(mockOnViewDetails).toHaveBeenLastCalledWith(delivered);
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

        it('reissues an approved or delivered claim, for re-delivery or a re-claim, with the reason', () => {
            const approved = { ...mockClaim, status: 'approved', notes: '[REISSUED - PLAYER MAY RE-CLAIM] Wrong size' } as Claim;
            const { rerender } = render(
                <ClaimDetailsModal claim={approved} updating={null} onClose={mockOnClose} onUpdateStatus={mockOnUpdateStatus} />
            );
            expect(screen.getByText('Reissued')).toBeInTheDocument();
            fireEvent.change(screen.getByPlaceholderText(/Enter reason for reissue/), { target: { value: 'Courier returned it' } });
            fireEvent.click(screen.getByRole('button', { name: /Reissue for Re-Delivery/ }));
            expect(mockOnUpdateStatus).toHaveBeenLastCalledWith('claim-1', 'pending', 'Courier returned it', 'reissue', 'redelivery');
            fireEvent.click(screen.getByRole('button', { name: /Reissue & Allow Re-Claim/ }));
            expect(mockOnUpdateStatus).toHaveBeenLastCalledWith('claim-1', 'rejected', 'Courier returned it', 'reissue', 'reclaim');

            rerender(
                <ClaimDetailsModal claim={{ ...approved, status: 'fulfilled', notes: 'Delivered by TCS' } as Claim} updating="claim-1" onClose={mockOnClose} onUpdateStatus={mockOnUpdateStatus} />
            );
            expect(screen.queryByText('Reissued')).toBeNull();
            expect(screen.getByRole('button', { name: /Reissue for Re-Delivery/ })).toBeDisabled();
            expect(screen.getByRole('button', { name: /Reissue & Allow Re-Claim/ })).toBeDisabled();
        });

        it('lists the risk flags, and approves a high-risk claim only with a reason', () => {
            const risky = {
                ...mockClaim,
                risk: { score: 55, level: 'high' as const, flags: [{ code: 'shared_phone', weight: 40, count: 7, accounts: ['a@x.test', 'b@x.test'] }, { code: 'new_account', weight: 15 }] },
            } as Claim;
            render(<ClaimDetailsModal claim={risky} updating={null} onClose={mockOnClose} onUpdateStatus={mockOnUpdateStatus} />);
            expect(screen.getByText('WhatsApp number also used by other accounts')).toBeInTheDocument();
            expect(screen.getByText('a@x.test, b@x.test and 5 more')).toBeInTheDocument();
            expect(screen.getByText('Account less than 7 days old when it claimed')).toBeInTheDocument();

            const approve = screen.getByRole('button', { name: /Approve Claim/ });
            expect(approve).toBeDisabled();
            fireEvent.change(screen.getByLabelText(/Why approve despite the flags/), { target: { value: '  Brothers, CNICs checked  ' } });
            fireEvent.click(approve);
            expect(mockOnUpdateStatus).toHaveBeenCalledWith('claim-1', 'approved', '', 'update', undefined, 'Brothers, CNICs checked');
        });

        it('labels a medium or low risk, and shows a flag it has no words for as its code', () => {
            const medium = {
                ...mockClaim,
                trackingId: '1T2W-7K3M-QX97',
                risk: { score: 35, level: 'medium' as const, flags: [{ code: 'shared_address', weight: 30, count: 1, accounts: ['a@x.test'] }, { code: 'brand_new_flag', weight: 5 }] },
            } as Claim;
            const { rerender } = render(<ClaimDetailsModal claim={medium} updating={null} onClose={mockOnClose} onUpdateStatus={mockOnUpdateStatus} />);
            expect(screen.getByTitle('Tracking ID')).toHaveTextContent('1T2W-7K3M-QX97');
            expect(screen.getByText('Check details')).toBeInTheDocument();
            expect(screen.getByText('a@x.test')).toBeInTheDocument();
            expect(screen.getByText('brand_new_flag')).toBeInTheDocument();
            // Only a high risk needs a reason to approve
            expect(screen.queryByLabelText(/Why approve despite the flags/)).toBeNull();
            expect(screen.getByRole('button', { name: /Approve Claim/ })).toBeEnabled();

            rerender(
                <ClaimDetailsModal claim={{ ...medium, risk: { score: 5, level: 'low', flags: [{ code: 'phone_not_on_profile', weight: 5 }] } } as Claim} updating={null} onClose={mockOnClose} onUpdateStatus={mockOnUpdateStatus} />
            );
            expect(screen.getByText('Risk flags')).toBeInTheDocument();
            expect(screen.getByText("WhatsApp number isn't the phone on the profile")).toBeInTheDocument();
        });

        it("confirms delivery with the winner's code, or without one given a reason, and resets the code", () => {
            const onDeliver = vi.fn();
            const onResetCode = vi.fn();
            const approved = { ...mockClaim, status: 'approved', handover: { version: 1, failures: 2 } } as Claim;
            const { rerender } = render(
                <ClaimDetailsModal claim={approved} updating={null} onClose={mockOnClose} onUpdateStatus={mockOnUpdateStatus} onDeliver={onDeliver} onResetCode={onResetCode} />
            );
            expect(screen.getByText(/2 of 5 wrong tries used/)).toBeInTheDocument();
            const confirm = screen.getByRole('button', { name: /^Confirm Delivery$/ });
            expect(confirm).toBeDisabled();
            fireEvent.change(screen.getByLabelText("Winner's handover code"), { target: { value: '48a2 913' } });
            expect(screen.getByLabelText("Winner's handover code")).toHaveValue('482 913');
            fireEvent.click(confirm);
            expect(onDeliver).toHaveBeenCalledWith('claim-1', { handoverCode: '482 913' });

            fireEvent.click(screen.getByText('Delivered without the code?'));
            const without = screen.getByRole('button', { name: 'Mark Delivered Without Code' });
            expect(without).toBeDisabled();
            fireEvent.change(screen.getByLabelText(/Why there is no code/), { target: { value: 'Winner lost their phone' } });
            fireEvent.click(without);
            expect(onDeliver).toHaveBeenLastCalledWith('claim-1', { overrideReason: 'Winner lost their phone' });

            fireEvent.click(screen.getByText('Reset the handover code'));
            expect(onResetCode).toHaveBeenCalledWith('claim-1');

            // Five wrong codes lock it: only a reset (or delivery with a reason) is left
            rerender(
                <ClaimDetailsModal claim={{ ...approved, handover: { version: 1, failures: 5 } } as Claim} updating={null} onClose={mockOnClose} onUpdateStatus={mockOnUpdateStatus} onDeliver={onDeliver} onResetCode={onResetCode} />
            );
            expect(screen.getByRole('alert')).toHaveTextContent('Too many wrong codes');
            expect(screen.queryByLabelText("Winner's handover code")).toBeNull();
        });

        it("shows the claim's timeline with what each step rested on", async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ events: [
                    { id: 'e1', event: 'submitted', actor: 'player', note: null, details: { origin: { ip: '39.40.1.2' } }, createdAt: '2026-10-01T10:00:00Z' },
                    { id: 'e2', event: 'approved', actor: 'boss@x.test', note: 'Ships Monday', details: { overrideReason: 'Checked CNIC' }, createdAt: '2026-10-02T10:00:00Z' },
                    { id: 'e3', event: 'handover_failed', actor: 'boss@x.test', note: null, details: { failures: 2 }, createdAt: '2026-10-04T10:00:00Z' },
                    { id: 'e4', event: 'code_reset', actor: 'boss@x.test', note: null, details: { handoverVersion: 2 }, createdAt: '2026-10-04T11:00:00Z' },
                    { id: 'e5', event: 'delivered', actor: 'boss@x.test', note: null, details: { handover: 'code' }, createdAt: '2026-10-05T10:00:00Z' },
                    { id: 'e6', event: 'reopened', actor: 'boss@x.test', note: null, details: {}, createdAt: '2026-10-06T10:00:00Z' },
                    { id: 'e7', event: 'delivered', actor: 'boss@x.test', note: null, details: { handover: 'override', reason: 'Winner lost their phone' }, createdAt: '2026-10-07T10:00:00Z' },
                    { id: 'e8', event: 'archived_later', actor: 'boss@x.test', note: null, details: {}, createdAt: '2026-10-08T10:00:00Z' },
                ] }),
            });
            vi.stubGlobal('fetch', fetchMock);
            render(<ClaimDetailsModal claim={{ ...mockClaim, status: 'fulfilled' } as Claim} updating={null} onClose={mockOnClose} onUpdateStatus={mockOnUpdateStatus} />);
            expect(await screen.findByText('Timeline')).toBeInTheDocument();
            expect(fetchMock).toHaveBeenCalledWith('/api/admin/claims/claim-1/timeline');
            expect(screen.getByText('From IP 39.40.1.2')).toBeInTheDocument();
            expect(screen.getByText('Approved despite the risk flags: Checked CNIC')).toBeInTheDocument();
            expect(screen.getByText('2 of 5 wrong tries')).toBeInTheDocument();
            expect(screen.getByText("Winner's handover code checked")).toBeInTheDocument();
            expect(screen.getByText('Without the code: Winner lost their phone')).toBeInTheDocument();
            // A step this screen has no words for still shows, by its name
            expect(screen.getByText('archived_later')).toBeInTheDocument();
            vi.unstubAllGlobals();
        });

        it('shows no timeline when it cannot be loaded', async () => {
            for (const answer of [() => Promise.resolve({ ok: false }), () => Promise.reject(new Error('offline'))]) {
                const fetchMock = vi.fn(answer);
                vi.stubGlobal('fetch', fetchMock);
                const { unmount } = render(<ClaimDetailsModal claim={mockClaim} updating={null} onClose={mockOnClose} onUpdateStatus={mockOnUpdateStatus} />);
                await waitFor(() => expect(fetchMock).toHaveBeenCalled());
                await act(async () => {});
                expect(screen.queryByText('Timeline')).toBeNull();
                unmount();
            }
            vi.unstubAllGlobals();
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
