'use client';

interface WalletDisplayProps {
    balance: number;
    isLoading?: boolean;
}

export default function WalletDisplay({ balance, isLoading = false }: WalletDisplayProps) {
    return (
        <div className="text-center">
            {/* Balance Label */}
            <p className="text-emerald-200 text-sm font-medium mb-2">1Think Wallet Balance</p>

            {/* Balance Amount */}
            {isLoading ? (
                <div className="flex items-center justify-center gap-2">
                    <div className="h-12 w-36 bg-white/10 rounded-lg animate-pulse"></div>
                </div>
            ) : (
                <div className="flex items-center justify-center gap-2">
                    <span className="text-4xl font-black text-white tracking-tight">
                        {balance.toFixed(2)}
                    </span>
                    <span className="text-lg font-semibold text-emerald-200 mt-1">PKR</span>
                </div>
            )}

            {/* Status Badge */}
            <div className="mt-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full text-xs font-medium text-emerald-300">
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
                    Active
                </span>
            </div>

            {/* Tip */}
            <p className="mt-4 text-emerald-200/50 text-xs">
                💡 Deposit funds to play quizzes and win prizes!
            </p>
        </div>
    );
}
