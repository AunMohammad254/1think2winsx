import '@/tests/helpers/ui';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  bank: {} as Record<string, unknown>,
}));
vi.mock('@/types/wallet', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/types/wallet')>();
  Object.assign(h.bank, real.ADMIN_BANK_DETAILS);
  return { ...real, ADMIN_BANK_DETAILS: h.bank };
});

import TransactionHistory from '@/components/wallet/TransactionHistory';
import DepositForm from '@/components/wallet/DepositForm';
import type { WalletTransaction } from '@/types/wallet';

const tx = (over: Partial<WalletTransaction>): WalletTransaction => ({
  id: Math.random().toString(36), userId: 'u', amount: 100, paymentMethod: 'Easypaisa', transactionId: 'TX1', status: 'approved',
  createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', ...over,
});

describe('TransactionHistory', () => {
  it('shows loading and empty states', () => {
    const { rerender } = render(<TransactionHistory transactions={[]} isLoading />);
    expect(screen.getByRole('status', { name: 'Loading transactions' })).toBeInTheDocument();
    rerender(<TransactionHistory transactions={[]} />);
    expect(screen.getByText('No Transactions')).toBeInTheDocument();
  });

  it('labels deposits by status and quiz-access deductions', () => {
    render(
      <TransactionHistory
        transactions={[
          tx({ status: 'approved' }),
          tx({ status: 'rejected', transactionId: 'TX2' }),
          tx({ status: 'pending', transactionId: 'quiz_access_x' }),
          tx({ amount: -2, paymentMethod: 'QuizAccess' as WalletTransaction['paymentMethod'], adminNotes: 'Daily pass' }),
          tx({ amount: -2, paymentMethod: 'Easypaisa', adminNotes: null }),
        ]}
      />,
    );
    expect(screen.getByRole('listitem', { name: 'Deposit of 100 PKR, status Approved' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Deposit of 100 PKR, status Rejected' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Deposit of 100 PKR, status Pending' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem', { name: 'Quiz Access of 2 PKR, status completed' })).toHaveLength(2);
    expect(screen.getByText('+100')).toBeInTheDocument();
    expect(screen.getByText('TX1')).toBeInTheDocument();
    expect(screen.queryByText('quiz_access_x')).toBeNull();
    expect(screen.getByText('Daily pass')).toBeInTheDocument();
  });

  it('loads more on demand', () => {
    render(<TransactionHistory transactions={Array.from({ length: 7 }, (_, i) => tx({ id: String(i) }))} initialLimit={3} loadMoreCount={3} />);
    expect(screen.getByText('Showing 3 of 7 transactions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load 4 more transactions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load 1 more transactions' }));
    expect(screen.getByText('Showing 7 of 7 transactions')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('DepositForm', () => {
  const fill = (amount: string, txId: string, file?: File) => {
    fireEvent.change(screen.getByLabelText('Amount (PKR)'), { target: { value: amount } });
    fireEvent.change(screen.getByLabelText('Transaction ID / Reference Number'), { target: { value: txId } });
    if (file) fireEvent.change(screen.getByLabelText(/Proof of Payment/), { target: { files: [file] } });
  };
  const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'Deposit form' }));

  it('validates amount, transaction id and proof before submitting', async () => {
    const onSubmit = vi.fn();
    render(<DepositForm onSubmit={onSubmit} />);
    fill('2', 'x');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Minimum deposit amount is 5 PKR');
    fill('50', '   ');
    submit();
    expect(await screen.findByText('Please enter the transaction ID from your payment app')).toBeInTheDocument();
    fill('50', 'TX9');
    submit();
    expect(await screen.findByText('Please upload a screenshot of your payment as proof')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the deposit and resets on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: true });
    render(<DepositForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Jazzcash' }));
    expect(screen.getByText(/Jazzcash details not available yet/)).toBeInTheDocument();
    fill('50', ' TX9 ', new File(['x'], 'proof.png', { type: 'image/png' }));
    expect(screen.getByText('Selected')).toBeInTheDocument();
    submit();
    expect(await screen.findByText('Deposit request submitted successfully!')).toBeInTheDocument();
    const fd = onSubmit.mock.calls[0][0] as FormData;
    expect([fd.get('amount'), fd.get('paymentMethod'), fd.get('transactionId')]).toEqual(['50', 'Jazzcash', 'TX9']);
    expect(fd.get('proofImage')).toBeInstanceOf(File);
    expect(screen.getByLabelText('Amount (PKR)')).toHaveValue(null);
  });

  it('forgets the proof when the file chooser is cancelled', async () => {
    const onSubmit = vi.fn();
    render(<DepositForm onSubmit={onSubmit} />);
    fill('50', 'TX9', new File(['x'], 'proof.png'));
    expect(screen.getByText('Selected')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Proof of Payment/), { target: { files: [] } });
    expect(screen.queryByText('Selected')).toBeNull();
    submit();
    expect(await screen.findByText('Please upload a screenshot of your payment as proof')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the server error, or a default one', async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce({ success: false, error: 'Duplicate transaction ID' }).mockResolvedValueOnce({ success: false });
    render(<DepositForm onSubmit={onSubmit} />);
    fill('50', 'TX9', new File(['x'], 'proof.png'));
    submit();
    expect(await screen.findByText('Duplicate transaction ID')).toBeInTheDocument();
    submit();
    expect(await screen.findByText('Failed to submit deposit request')).toBeInTheDocument();
  });

  it('shows the account for each payment method that has one configured', () => {
    Object.assign(h.bank, {
      jazzcash: { accountName: 'JC Name', accountNumber: '0300' },
      bank: { bankName: 'HBL', accountName: 'Bank Name', accountNumber: '1234', iban: 'PK00HBL' },
    });
    const { rerender } = render(<DepositForm onSubmit={vi.fn()} isSubmitting />);
    expect(screen.getByRole('button', { name: /Submitting/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Jazzcash' }));
    expect(screen.getByText('JC Name')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Bank' }));
    expect(screen.getByText('PK00HBL')).toBeInTheDocument();
    h.bank.bank = { bankName: 'HBL', accountName: 'Bank Name', accountNumber: '1234' };
    rerender(<DepositForm onSubmit={vi.fn()} />);
    expect(screen.queryByText('IBAN:')).toBeNull();
    delete h.bank.bank;
    delete h.bank.easypaisa;
    rerender(<DepositForm onSubmit={vi.fn()} key="fresh" />);
    expect(screen.getByText(/Send payment to this account/).parentElement!.textContent).not.toContain('Account Name');
    fireEvent.click(screen.getByRole('radio', { name: 'Bank' }));
    expect(screen.getByText(/Bank transfer details not available yet/)).toBeInTheDocument();
  });
});
