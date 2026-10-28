import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClaimTracking } from '@/components/prize-redemption/ClaimTracking';
import { ANTI_SCAM_NOTICE } from '@/lib/claim-tracking-shared';

describe('ClaimTracking (the winner’s view of a claim)', () => {
  it('shows nothing for a claim without a tracking ID', () => {
    const { container } = render(<ClaimTracking trackingId={null} handoverCode="482913" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the tracking ID and how to tell our messages from a scam', () => {
    render(<ClaimTracking trackingId="1T2W-7K3M-QX97" />);
    expect(screen.getByText('1T2W-7K3M-QX97')).toBeInTheDocument();
    expect(screen.getByText(ANTI_SCAM_NOTICE)).toBeInTheDocument();
    expect(screen.queryByText('Handover code')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show history' })).toBeNull();
  });

  it('shows the handover code while the prize is on its way', () => {
    render(<ClaimTracking trackingId="1T2W-7K3M-QX97" handoverCode="482913" />);
    expect(screen.getByText('Handover code')).toBeInTheDocument();
    expect(screen.getByText('482 913')).toBeInTheDocument();
  });

  it('opens the history, flagging a wrong code someone entered', () => {
    render(
      <ClaimTracking
        trackingId="1T2W-7K3M-QX97"
        timeline={[
          { event: 'submitted', at: '2026-10-01T10:00:00Z' },
          { event: 'handover_failed', at: '2026-10-03T10:00:00Z' },
          { event: 'rejected', at: '2026-10-04T10:00:00Z', note: 'Address incomplete' },
        ]}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Show history' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByText(/Claim received/)).toBeInTheDocument();
    expect(screen.getByText(/A wrong handover code was entered/)).toBeInTheDocument();
    expect(screen.getByText('If nobody asked you for your code, contact support.')).toBeInTheDocument();
    expect(screen.getByText('Address incomplete')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide history' }));
    expect(screen.queryByText(/Claim received/)).toBeNull();
  });
});
