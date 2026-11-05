import { render, screen, fireEvent } from '@testing-library/react';
import InsufficientBalanceModal from '@/components/quiz/InsufficientBalanceModal';

describe('InsufficientBalanceModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    walletBalance: 10,
    accessPrice: 25,
    handleGoToWallet: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<InsufficientBalanceModal {...defaultProps} isOpen={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the modal content when isOpen is true', () => {
    render(<InsufficientBalanceModal {...defaultProps} />);
    expect(screen.getByText('Insufficient Balance')).toBeInTheDocument();
    expect(screen.getByText('Please add funds to your wallet')).toBeInTheDocument();
  });

  it('displays correct calculations for balances', () => {
    render(<InsufficientBalanceModal {...defaultProps} />);

    // walletBalance is 10.00
    expect(screen.getByText('10.00 PKR')).toBeInTheDocument();
    // accessPrice is 25.00
    expect(screen.getByText('25.00 PKR')).toBeInTheDocument();
    // amount needed is 15.00
    expect(screen.getByText('15.00 PKR')).toBeInTheDocument();
  });

  it('calls onClose when the close (×) button is clicked', () => {
    render(<InsufficientBalanceModal {...defaultProps} />);
    const closeButton = screen.getByText('×').closest('button');
    fireEvent.click(closeButton!);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the Cancel button is clicked', () => {
    render(<InsufficientBalanceModal {...defaultProps} />);
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls handleGoToWallet when Manage Wallet button is clicked', () => {
    render(<InsufficientBalanceModal {...defaultProps} />);
    const manageWalletButton = screen.getByRole('button', { name: /Manage Wallet/i });
    fireEvent.click(manageWalletButton);
    expect(defaultProps.handleGoToWallet).toHaveBeenCalledTimes(1);
  });

  it('formats amount to 2 decimal places even when zero', () => {
    render(
      <InsufficientBalanceModal
        {...defaultProps}
        walletBalance={0}
        accessPrice={2.5}
      />
    );
    expect(screen.getByText('0.00 PKR')).toBeInTheDocument();
    expect(screen.getAllByText('2.50 PKR')).toHaveLength(2); // required and needed amount
  });
});
