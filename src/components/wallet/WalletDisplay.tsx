'use client';

interface WalletDisplayProps {
    balance: number;
    isLoading?: boolean;
}

export default function WalletDisplay({ balance, isLoading = false }: WalletDisplayProps) {
    return (
        <div className="backdrop-blur-xl bg-gradient-to-br from-emerald-500/20 to-green-500/20 border border-emerald-500/30 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-gradient-to-r from-emerald-400 to-green-400 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/25">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                </div>
                <div className="flex-1">
                    <p className="text-emerald-200 text-sm font-medium mb-1">1Think Wallet Balance</p>
                    {isLoading ? (
                        <div className="h-8 w-28 bg-white/10 rounded animate-pulse"></div>
                    ) : (
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-white">{balance.toFixed(2)}</span>
                            <span className="text-emerald-200 text-lg font-medium">PKR</span>
                        </div>
                    )}
                </div>
                <div className="hidden sm:block">
                    <div className="px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full">
                        <span className="text-emerald-300 text-xs font-medium">Active</span>
                    </div>
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-emerald-500/20">
                <p className="text-emerald-200/70 text-xs">
                    💡 Deposit funds to play quizzes and win amazing prizes!
                </p>
            </div>
        </div>
    );
}
