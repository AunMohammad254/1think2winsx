'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
                // Refresh data
                await loadWalletData();
            }
            return { success: result.success, error: result.error };
        } finally {
            setIsSubmitting(false);
        }
    };

    if (authLoading || isLoading) {
        return (
            <div className="min-h-screen relative overflow-hidden">
                {/* Animated Background */}
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%224%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20"></div>
                    <div className="absolute top-0 left-0 w-full h-full">
                        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse"></div>
                        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
                    </div>
                </div>

                <div className="relative z-10 flex items-center justify-center min-h-screen">
                    <div className="text-center">
                        <div className="w-20 h-20 mx-auto mb-6 relative">
                            <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-blue-400 rounded-full animate-spin"></div>
                            <div className="absolute inset-2 bg-slate-900 rounded-full flex items-center justify-center">
                                <div className="w-8 h-8 bg-gradient-to-r from-emerald-400 to-blue-400 rounded-full"></div>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent mb-2">
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
            {/* Animated Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%224%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20"></div>
                <div className="absolute top-0 left-0 w-full h-full">
                    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse"></div>
                    <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
                    <div className="absolute top-3/4 left-1/2 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-2000"></div>
                </div>
            </div>

            <div className="relative z-10 container mx-auto px-4 py-6 lg:py-12">
                <div className="max-w-4xl mx-auto space-y-6 lg:space-y-8">
                    {/* Header */}
                    <div className="flex items-center gap-4">
                        <Link
                            href="/profile"
                            className="p-2 backdrop-blur-xl bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all duration-200"
                        >
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </Link>
                        <div>
                            <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
                                1Think Wallet
                            </h1>
                            <p className="text-slate-400 text-sm">Manage your deposits and balance</p>
                        </div>
                    </div>

                    {/* Wallet Balance */}
                    <WalletDisplay balance={balance} isLoading={isLoading} />

                    {/* Two Column Layout for Desktop */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Deposit Form */}
                        <div>
                            <DepositForm onSubmit={handleDepositSubmit} isSubmitting={isSubmitting} />
                        </div>

                        {/* Quick Info Card */}
                        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                How It Works
                            </h3>
                            <div className="space-y-4">
                                <div className="flex gap-3">
                                    <div className="w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                                        <span className="text-blue-400 font-semibold text-sm">1</span>
                                    </div>
                                    <div>
                                        <h4 className="text-white font-medium text-sm">Send Payment</h4>
                                        <p className="text-slate-400 text-xs">Transfer money to the displayed account via Easypaisa</p>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                                        <span className="text-purple-400 font-semibold text-sm">2</span>
                                    </div>
                                    <div>
                                        <h4 className="text-white font-medium text-sm">Submit Request</h4>
                                        <p className="text-slate-400 text-xs">Enter the transaction ID from your payment confirmation</p>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <div className="w-8 h-8 bg-emerald-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                                        <span className="text-emerald-400 font-semibold text-sm">3</span>
                                    </div>
                                    <div>
                                        <h4 className="text-white font-medium text-sm">Get Credits</h4>
                                        <p className="text-slate-400 text-xs">Once admin approves, credits are added to your wallet</p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                                <div className="flex items-start gap-2">
                                    <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                    </svg>
                                    <div>
                                        <p className="text-amber-300 font-medium text-sm">Important</p>
                                        <p className="text-amber-200/70 text-xs mt-1">
                                            Use the exact transaction ID from your payment app. Incorrect IDs may result in rejection.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Transaction History */}
                    <TransactionHistory transactions={transactions} isLoading={isLoading} />
                </div>
            </div>
        </div>
    );
}
