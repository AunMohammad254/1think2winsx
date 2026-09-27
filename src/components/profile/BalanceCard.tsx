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
        <section
            aria-label="Wallet balance"
            className="relative backdrop-blur-xl bg-linear-to-br from-emerald-600/25 via-emerald-500/15 to-teal-500/20 border border-emerald-400/20 rounded-4xl p-6 shadow-2xl shadow-emerald-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            tabIndex={-1}
        >
            <p className="text-center text-emerald-100/80 text-sm font-medium mb-2">
                Total Balance
            </p>

            {isLoading ? (
                <div
                    className="flex items-center justify-center gap-2"
                    role="status"
                    aria-live="polite"
                >
                    <div className="h-12 w-40 bg-white/10 rounded-lg animate-pulse" />
                </div>
            ) : (
                <div
                    className="flex items-baseline justify-center gap-2"
                    aria-live="polite"
                >
                    <span className="text-5xl font-black text-white tracking-tight tabular-nums">
                        {balance.toFixed(2)}
                    </span>
                    <span className="text-xl font-semibold text-emerald-200/80">
                        {currency}
                    </span>
                </div>
            )}

            {/* Accessible screen-reader summary */}
            <span className="sr-only">
                Current wallet balance: {balance.toFixed(2)} {currency}.
            </span>

            <div
                aria-hidden="true"
                className="mt-4 h-1 w-24 mx-auto bg-linear-to-r from-emerald-300 via-teal-300 to-emerald-300 rounded-full opacity-60"
            />
        </section>
    );
}
