'use client';

interface BalanceCardProps {
    balance: number;
    currency?: string;
    isLoading?: boolean;
}

export default function BalanceCard({
    balance,
    currency = 'PKR',
    isLoading = false
}: BalanceCardProps) {
    return (
        <div className="backdrop-blur-xl bg-gradient-to-br from-purple-600/30 via-blue-600/20 to-pink-600/20 border border-white/10 rounded-[32px] p-6 shadow-2xl">
            {/* Balance Label */}
            <p className="text-center text-slate-300 text-sm font-medium mb-2">Total Balance</p>

            {/* Balance Amount */}
            {isLoading ? (
                <div className="flex items-center justify-center gap-2">
                    <div className="h-12 w-40 bg-white/10 rounded-lg animate-pulse"></div>
                </div>
            ) : (
                <div className="flex items-center justify-center gap-2">
                    <span className="text-5xl font-black text-white tracking-tight">
                        {balance.toFixed(2)}
                    </span>
                    <span className="text-xl font-semibold text-slate-300 mt-2">{currency}</span>
                </div>
            )}

            {/* Decorative gradient line */}
            <div className="mt-4 h-1 w-24 mx-auto bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 rounded-full opacity-50"></div>
        </div>
    );
}
