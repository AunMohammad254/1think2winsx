'use client';

import { useState } from 'react';
import { PaymentMethod, ADMIN_BANK_DETAILS, MIN_DEPOSIT_AMOUNT } from '@/types/wallet';

interface DepositFormProps {
    onSubmit: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
    isSubmitting?: boolean;
}

export default function DepositForm({ onSubmit, isSubmitting = false }: DepositFormProps) {
    const [amount, setAmount] = useState<string>('');
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Easypaisa');
    const [transactionId, setTransactionId] = useState<string>('');
    const [proofImage, setProofImage] = useState<File | null>(null);
    const [error, setError] = useState<string>('');
    const [success, setSuccess] = useState<boolean>(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');
        setSuccess(false);

        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum < MIN_DEPOSIT_AMOUNT) {
            setError(`Minimum deposit amount is ${MIN_DEPOSIT_AMOUNT} PKR`);
            return;
        }

        if (!transactionId.trim()) {
            setError('Please enter the transaction ID from your payment app');
            return;
        }

        if (!proofImage) {
            setError('Please upload a screenshot of your payment as proof');
            return;
        }

        const formData = new FormData();
        formData.append('amount', amount);
        formData.append('paymentMethod', paymentMethod);
        formData.append('transactionId', transactionId.trim());
        if (proofImage) {
            formData.append('proofImage', proofImage);
        }

        const result = await onSubmit(formData);

        if (result.success) {
            setSuccess(true);
            setAmount('');
            setTransactionId('');
            setProofImage(null);
        } else {
            setError(result.error || 'Failed to submit deposit request');
        }
    };

    const getBankDetails = () => {
        switch (paymentMethod) {
            case 'Easypaisa':
                return ADMIN_BANK_DETAILS.easypaisa ? (
                    <div className="space-y-2">
                        <p className="text-sm"><span className="text-slate-400">Account Name:</span> <span className="text-white font-medium">{ADMIN_BANK_DETAILS.easypaisa.accountName}</span></p>
                        <p className="text-sm"><span className="text-slate-400">Account Number:</span> <span className="text-white font-medium tabular-nums">{ADMIN_BANK_DETAILS.easypaisa.accountNumber}</span></p>
                    </div>
                ) : null;
            case 'Jazzcash':
                return ADMIN_BANK_DETAILS.jazzcash ? (
                    <div className="space-y-2">
                        <p className="text-sm"><span className="text-slate-400">Account Name:</span> <span className="text-white font-medium">{ADMIN_BANK_DETAILS.jazzcash.accountName}</span></p>
                        <p className="text-sm"><span className="text-slate-400">Account Number:</span> <span className="text-white font-medium tabular-nums">{ADMIN_BANK_DETAILS.jazzcash.accountNumber}</span></p>
                    </div>
                ) : (
                    <p className="text-amber-300 text-sm">Jazzcash details not available yet. Please use Easypaisa.</p>
                );
            case 'Bank':
                return ADMIN_BANK_DETAILS.bank ? (
                    <div className="space-y-2">
                        <p className="text-sm"><span className="text-slate-400">Bank:</span> <span className="text-white font-medium">{ADMIN_BANK_DETAILS.bank.bankName}</span></p>
                        <p className="text-sm"><span className="text-slate-400">Account Name:</span> <span className="text-white font-medium">{ADMIN_BANK_DETAILS.bank.accountName}</span></p>
                        <p className="text-sm"><span className="text-slate-400">Account Number:</span> <span className="text-white font-medium tabular-nums">{ADMIN_BANK_DETAILS.bank.accountNumber}</span></p>
                        {ADMIN_BANK_DETAILS.bank.iban && (
                            <p className="text-sm"><span className="text-slate-400">IBAN:</span> <span className="text-white font-medium tabular-nums">{ADMIN_BANK_DETAILS.bank.iban}</span></p>
                        )}
                    </div>
                ) : (
                    <p className="text-amber-300 text-sm">Bank transfer details not available yet. Please use Easypaisa.</p>
                );
            default:
                return null;
        }
    };

    return (
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-white/10">
                <div className="flex items-center gap-3">
                    <div
                        className="w-10 h-10 bg-linear-to-r from-emerald-500 to-teal-600 rounded-full flex items-center justify-center"
                        aria-hidden="true"
                    >
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-bold text-white">
                        Deposit Funds
                    </h2>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6" aria-label="Deposit form">
                {success && (
                    <div
                        className="p-4 bg-emerald-500/20 border border-emerald-400/30 rounded-xl"
                        role="status"
                        aria-live="polite"
                    >
                        <div className="flex items-center gap-3">
                            <svg className="w-5 h-5 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <p className="text-emerald-100 font-medium">Deposit request submitted successfully!</p>
                        </div>
                        <p className="text-emerald-200/80 text-sm mt-2">
                            Your request is pending admin approval. You&apos;ll receive credits once approved.
                        </p>
                    </div>
                )}

                {error && (
                    <div
                        className="p-4 bg-rose-500/20 border border-rose-400/30 rounded-xl"
                        role="alert"
                    >
                        <div className="flex items-center gap-3">
                            <svg className="w-5 h-5 text-rose-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-rose-100 font-medium">{error}</p>
                        </div>
                    </div>
                )}

                <fieldset>
                    <legend className="block text-sm font-medium text-slate-200 mb-3">
                        Select Payment Method
                    </legend>
                    <div
                        className="grid grid-cols-3 gap-3"
                        role="radiogroup"
                        aria-label="Payment method"
                    >
                        {(['Easypaisa', 'Jazzcash', 'Bank'] as PaymentMethod[]).map((method) => {
                            const selected = paymentMethod === method;
                            return (
                                <button
                                    key={method}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    onClick={() => setPaymentMethod(method)}
                                    className={`p-3 rounded-xl border text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
                                        selected
                                            ? 'bg-linear-to-r from-emerald-500/25 to-teal-600/25 border-emerald-400/50 text-white shadow-lg shadow-emerald-900/20'
                                            : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                                    }`}
                                >
                                    {method}
                                </button>
                            );
                        })}
                    </div>
                </fieldset>

                <div className="p-4 bg-blue-700/10 border border-blue-500/20 rounded-xl">
                    <h3 className="text-sm font-medium text-blue-200 mb-3 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Send payment to this account:
                    </h3>
                    {getBankDetails()}
                </div>

                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex gap-3 items-start">
                    <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-amber-200/90 leading-relaxed">
                        Deposits typically take <strong>1-2 business days</strong> to reflect in your wallet after admin review.
                    </p>
                </div>

                <div>
                    <label htmlFor="deposit-amount" className="block text-sm font-medium text-slate-200 mb-2">
                        Amount (PKR)
                    </label>
                    <div className="relative">
                        <input
                            type="number"
                            id="deposit-amount"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder={`Minimum ${MIN_DEPOSIT_AMOUNT} PKR`}
                            min={MIN_DEPOSIT_AMOUNT}
                            step="1"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/40 transition-all duration-200"
                            required
                            aria-describedby="deposit-amount-help"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden="true">PKR</span>
                    </div>
                </div>

                <div>
                    <label htmlFor="deposit-transaction-id" className="block text-sm font-medium text-slate-200 mb-2">
                        Transaction ID / Reference Number
                    </label>
                    <input
                        type="text"
                        id="deposit-transaction-id"
                        value={transactionId}
                        onChange={(e) => setTransactionId(e.target.value)}
                        placeholder="Enter the reference number from your payment app"
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/40 transition-all duration-200"
                        required
                        aria-describedby="deposit-tx-help"
                    />
                    <p id="deposit-tx-help" className="text-slate-400 text-xs mt-2">
                        This is the unique ID shown in your payment confirmation
                    </p>
                </div>

                <div>
                    <label htmlFor="deposit-proof" className="block text-sm font-medium text-slate-200 mb-2 items-center gap-2">
                        Proof of Payment (Screenshot) *
                        {proofImage ? (
                            <span className="flex items-center gap-1 text-emerald-400 text-xs font-normal">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Selected
                            </span>
                        ) : (
                            <span className="text-rose-400/70 text-xs font-normal">(required)</span>
                        )}
                    </label>
                    <input
                        type="file"
                        id="deposit-proof"
                        accept="image/*"
                        onChange={(e) => setProofImage(e.target.files?.[0] || null)}
                        className={`w-full px-4 py-3 bg-white/5 border rounded-xl text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-500/20 file:text-emerald-300 hover:file:bg-emerald-500/30 transition-all duration-200 ${
                            proofImage ? 'border-emerald-400/50' : 'border-emerald-400/30'
                        }`}
                        required
                        aria-describedby="deposit-proof-help"
                    />
                    <p id="deposit-proof-help" className="text-slate-400 text-xs mt-2">
                        Required: Upload a clear screenshot of your successful transaction (Max 5MB)
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`w-full py-4 rounded-xl font-semibold text-white transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
                        isSubmitting
                        ? 'bg-slate-600 cursor-not-allowed'
                        : 'bg-linear-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 shadow-lg hover:shadow-emerald-500/25'
                    }`}
                >
                    {isSubmitting ? (
                        <span className="flex items-center justify-center gap-2">
                            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Submitting...
                        </span>
                    ) : (
                        'Submit Deposit Request'
                    )}
                </button>

                <p className="text-slate-400 text-xs text-center">
                    After submission, your deposit will be reviewed by admin. Credits will be added upon approval.
                </p>
            </form>
        </div>
    );
}
