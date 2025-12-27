'use client';

import { useState, useEffect } from 'react';
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

    if (authLoading || isLoading) {
        return (
            <div className="min-h-screen relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
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
            {/* Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
                <div className="absolute top-0 left-0 w-full h-full">
                    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse"></div>
                    <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
                    <div className="absolute top-3/4 left-1/2 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-2000"></div>
                </div>
            </div>

            {/* Content */}
            <div className="relative z-10 container mx-auto px-4 py-6">
                <div className="max-w-md mx-auto space-y-6">

                    {/* Header */}
                    <ProfileHeader title="1Think Wallet" backHref="/profile" />

                    {/* Wallet Balance */}
                    <div className="backdrop-blur-xl bg-gradient-to-br from-emerald-500/20 to-green-500/20 border border-emerald-500/30 rounded-[32px] p-6 shadow-lg">
                        <WalletDisplay balance={balance} isLoading={isLoading} />
                    </div>

                    {/* Deposit Form */}
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden">
                        <div className="p-5 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-r from-emerald-400 to-green-400 rounded-full flex items-center justify-center">
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] p-5">
                        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                            <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            How It Works
                        </h3>
                        <div className="space-y-3">
                            <div className="flex gap-3">
                                <div className="w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                                    <span className="text-blue-400 font-semibold text-xs">1</span>
                                </div>
                                <div>
                                    <h4 className="text-white font-medium text-sm">Send Payment</h4>
                                    <p className="text-slate-400 text-xs">Transfer via Easypaisa to displayed account</p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                                    <span className="text-purple-400 font-semibold text-xs">2</span>
                                </div>
                                <div>
                                    <h4 className="text-white font-medium text-sm">Submit Request</h4>
                                    <p className="text-slate-400 text-xs">Enter the transaction ID</p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className="w-8 h-8 bg-emerald-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                                    <span className="text-emerald-400 font-semibold text-xs">3</span>
                                </div>
                                <div>
                                    <h4 className="text-white font-medium text-sm">Get Credits</h4>
                                    <p className="text-slate-400 text-xs">Credits added after admin approval</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Transaction History */}
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-[32px] overflow-hidden">
                        <div className="p-5 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full flex items-center justify-center">
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <h2 className="text-lg font-bold text-white">Transaction History</h2>
                            </div>
                        </div>
                        <div className="p-5">
                            <TransactionHistory transactions={transactions} isLoading={isLoading} />
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
