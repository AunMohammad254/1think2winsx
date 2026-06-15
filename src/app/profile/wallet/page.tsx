'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { ProfileHeader } from '@/components/profile';
import WalletDisplay from '@/components/wallet/WalletDisplay';
import DepositForm from '@/components/wallet/DepositForm';
import TransactionHistory from '@/components/wallet/TransactionHistory';
import { submitDepositRequest, getWalletBalance, getTransactionHistory } from './actions';
import { WalletTransaction } from '@/types/wallet';

export default function WalletPage() {
    const { user, isLoading: authLoading } = useAuth();
    const router = useRouter();
    const [balance, setBalance] = useState<number>(0);
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (authLoading) return;

        if (!user) {
            router.push('/login');
            return;
        }

        loadWalletData();
    }, [user, authLoading, router]);

    const loadWalletData = async () => {
        setIsLoading(true);
        try {
            const [balanceResult, historyResult] = await Promise.all([
                getWalletBalance(),
                getTransactionHistory(),
            ]);

            if (balanceResult.success) {
                setBalance(balanceResult.balance || 0);
            }

            if (historyResult.success) {
                setTransactions(historyResult.transactions || []);
            }
        } catch (error) {
            console.error('Error loading wallet data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDepositSubmit = async (formData: FormData): Promise<{ success: boolean; error?: string }> => {
        setIsSubmitting(true);
        try {
            const result = await submitDepositRequest(formData);
            if (result.success) {
                await loadWalletData();
            }
            return { success: result.success, error: result.error };
        } finally {
            setIsSubmitting(false);
        }
    };

    // Derive pending transaction counts and totals from current data (no new data fields).
    const { pendingDeposits, pendingDeductions, pendingTotal } = useMemo(() => {
        const pending = transactions.filter((t) => t.status === 'pending');
        const deposits = pending.filter((t) => t.paymentMethod !== 'QuizAccess' && t.amount > 0);
        const deductions = pending.filter((t) => t.paymentMethod === 'QuizAccess' || t.amount < 0);
        const total = pending.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        return {
            pendingDeposits: deposits.length,
            pendingDeductions: deductions.length,
            pendingTotal: total,
        };
    }, [transactions]);

    if (authLoading || isLoading) {
        return (
            <div className="min-h-screen relative overflow-hidden" role="status" aria-label="Loading wallet">
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900" aria-hidden="true">
                    <div className="absolute top-0 left-0 w-full h-full">
                        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse"></div>
                        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
                    </div>
                </div>

                <div className="relative z-10 flex items-center justify-center min-h-screen">
                    <div className="text-center">
                        <div className="w-20 h-20 mx-auto mb-6 relative">
                            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full animate-spin" aria-hidden="true"></div>
                            <div className="absolute inset-2 bg-slate-900 rounded-full flex items-center justify-center">
                                <div className="w-8 h-8 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full" aria-hidden="true"></div>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent mb-2">
                            Loading Wallet
                        </h2>
                        <p className="text-slate-400">Preparing your wallet data...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900" aria-hidden="true">
                <div className="absolute top-0 left-0 w-full h-full">
                    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse"></div>
                    <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
                    <div className="absolute top-3/4 left-1/2 w-64 h-64 bg-amber-500/8 rounded-full blur-3xl animate-pulse delay-2000"></div>
                </div>
            </div>

            <div className="relative z-10 container mx-auto px-4 py-6 lg:py-8">
                <div className="max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto space-y-6 lg:space-y-8">

                    <ProfileHeader title="1Think Wallet" backHref="/profile" />

                    {/* CRITICAL METRICS - balance + pending for at-a-glance */}
                    <section
                        aria-label="Wallet critical metrics"
                        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                    >
                        {/* Available Balance */}
                        <div className="backdrop-blur-xl bg-gradient-to-br from-emerald-600/25 via-emerald-500/15 to-teal-600/20 border border-emerald-400/20 rounded-[32px] p-6 shadow-2xl shadow-emerald-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60" tabIndex={-1}>
                            <div className="flex items-center gap-2 mb-3">
                                <div
                                    className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center"
                                    aria-hidden="true"
                                >
                                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                    </svg>
                                </div>
                                <h2 className="text-sm font-semibold text-emerald-100 uppercase tracking-wider">
                                    Available Balance
                                </h2>
                            </div>
                            <div
                                className="flex items-baseline gap-2"
                                aria-live="polite"
                            >
                                <span className="text-4xl font-black text-white tracking-tight tabular-nums">
                                    {balance.toFixed(2)}
                                </span>
                                <span className="text-lg font-semibold text-emerald-100">
                                    PKR
                                </span>
                            </div>
                            <span className="sr-only">
                                Available balance: {balance.toFixed(2)} PKR.
                            </span>
                        </div>

                        {/* Pending Transactions */}
                        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60" tabIndex={-1}>
                            <div className="flex items-center gap-2 mb-3">
                                <div
                                    className="w-9 h-9 bg-gradient-to-br from-amber-500 to-amber-700 rounded-full flex items-center justify-center"
                                    aria-hidden="true"
                                >
                                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <h2 className="text-sm font-semibold text-amber-100 uppercase tracking-wider">
                                    Pending Transactions
                                </h2>
                            </div>
                            <div
                                className="flex items-baseline gap-2"
                                aria-live="polite"
                            >
                                <span className="text-4xl font-black text-white tracking-tight tabular-nums">
                                    {pendingDeposits + pendingDeductions}
                                </span>
                                <span className="text-lg font-semibold text-amber-100">
                                    {pendingTotal > 0 ? `· ${pendingTotal.toFixed(0)} PKR` : ''}
                                </span>
                            </div>
                            <p className="text-slate-400 text-xs mt-2">
                                {pendingDeposits + pendingDeductions === 0
                                    ? 'No pending items'
                                    : `${pendingDeposits} deposit${pendingDeposits === 1 ? '' : 's'} · ${pendingDeductions} deduction${pendingDeductions === 1 ? '' : 's'}`}
                            </p>
                            <span className="sr-only">
                                {pendingDeposits + pendingDeductions} pending transactions totalling {pendingTotal.toFixed(0)} PKR.
                            </span>
                        </div>
                    </section>

                    {/* Wallet Balance Display (existing component) */}
                    <div className="backdrop-blur-xl bg-gradient-to-br from-emerald-600/20 via-emerald-500/10 to-teal-600/15 border border-emerald-400/20 rounded-[32px] p-6 shadow-lg">
                        <WalletDisplay
                            balance={balance}
                            pendingDeposits={pendingDeposits}
                            pendingDeductions={pendingDeductions}
                            isLoading={isLoading}
                        />
                    </div>

                    {/* Wallet Detail Card - status badges + tip */}
                    <div className="backdrop-blur-xl bg-gradient-to-br from-emerald-600/15 via-emerald-500/8 to-teal-600/12 border border-emerald-400/15 rounded-[32px] p-6 shadow-lg">
                        <WalletDisplay
                            balance={balance}
                            pendingDeposits={pendingDeposits}
                            pendingDeductions={pendingDeductions}
                            isLoading={isLoading}
                        />
                    </div>

                    {/* Deposit Form */}
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden">
                        <div className="p-5 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full flex items-center justify-center"
                                    aria-hidden="true"
                                >
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                    </svg>
                                </div>
                                <h2 className="text-lg font-bold text-white">Add Funds</h2>
                            </div>
                        </div>
                        <div className="p-5">
                            <DepositForm onSubmit={handleDepositSubmit} isSubmitting={isSubmitting} />
                        </div>
                    </div>

                    {/* How It Works */}
                    <section className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] p-5" aria-label="How deposits work">
                        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                            <svg className="w-4 h-4 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            How It Works
                        </h3>
                        <ol className="space-y-3" role="list">
                            <li className="flex gap-3">
                                <div
                                    className="w-8 h-8 bg-blue-600/20 rounded-full flex items-center justify-center flex-shrink-0"
                                    aria-hidden="true"
                                >
                                    <span className="text-blue-200 font-semibold text-xs">1</span>
                                </div>
                                <div>
                                    <h4 className="text-white font-medium text-sm">Send Payment</h4>
                                    <p className="text-slate-400 text-xs">Transfer via Easypaisa to displayed account</p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <div
                                    className="w-8 h-8 bg-blue-700/20 rounded-full flex items-center justify-center flex-shrink-0"
                                    aria-hidden="true"
                                >
                                    <span className="text-blue-200 font-semibold text-xs">2</span>
                                </div>
                                <div>
                                    <h4 className="text-white font-medium text-sm">Submit Request</h4>
                                    <p className="text-slate-400 text-xs">Enter the transaction ID</p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <div
                                    className="w-8 h-8 bg-emerald-500/20 rounded-full flex items-center justify-center flex-shrink-0"
                                    aria-hidden="true"
                                >
                                    <span className="text-emerald-200 font-semibold text-xs">3</span>
                                </div>
                                <div>
                                    <h4 className="text-white font-medium text-sm">Get Credits</h4>
                                    <p className="text-slate-400 text-xs">Credits added after admin approval</p>
                                </div>
                            </li>
                        </ol>
                    </section>

                    {/* Transaction History */}
                    <section className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden" aria-label="Transaction history">
                        <div className="p-5 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-10 h-10 bg-gradient-to-r from-blue-600 to-blue-800 rounded-full flex items-center justify-center"
                                    aria-hidden="true"
                                >
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <h2 className="text-lg font-bold text-white">Transaction History</h2>
                                {transactions.length > 0 && (
                                    <span
                                        className="ml-auto text-xs font-medium text-blue-100 bg-blue-500/15 border border-blue-400/30 rounded-full px-2 py-0.5"
                                        aria-label={`${transactions.length} total transactions`}
                                    >
                                        {transactions.length}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="p-5">
                            <TransactionHistory transactions={transactions} isLoading={isLoading} />
                        </div>
                    </section>

                </div>
            </div>
        </div>
    );
}
