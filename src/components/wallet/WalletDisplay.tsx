'use client';

interface WalletDisplayProps {
    balance: number;
    pendingDeposits?: number;
    pendingDeductions?: number;
    isLoading?: boolean;
}

export default function WalletDisplay({
    balance,
    pendingDeposits = 0,
    pendingDeductions = 0,
    isLoading = false
}: WalletDisplayProps) {
    const hasPending = pendingDeposits + pendingDeductions > 0;

    return (
        <section
            aria-label="Wallet balance"
            className="text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 rounded-2xl"
            tabIndex={-1}
        >
            <p className="text-emerald-100 text-sm font-medium mb-2">
                1Think Wallet Balance
            </p>

            {isLoading ? (
                <div
                    className="flex items-center justify-center gap-2"
                    role="status"
                    aria-live="polite"
                >
                    <div className="h-12 w-36 bg-white/10 rounded-lg animate-pulse" />
                </div>
            ) : (
                <div
                    className="flex items-baseline justify-center gap-2"
                    aria-live="polite"
                >
                    <span className="text-4xl font-black text-white tracking-tight tabular-nums">
                        {balance.toFixed(2)}
                    </span>
                    <span className="text-lg font-semibold text-emerald-100 mt-1">
                        PKR
                    </span>
                </div>
            )}

            {/* Status badges */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 border border-emerald-400/30 rounded-full text-xs font-medium text-emerald-100"
                    aria-label="Wallet is active"
                >
                    <span
                        className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-pulse"
                        aria-hidden="true"
                    />
                    Active
                </span>
                {hasPending && (
                    <span
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 border border-amber-400/30 rounded-full text-xs font-medium text-amber-100"
                        aria-label={`${pendingDeposits + pendingDeductions} pending transactions`}
                    >
                        <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M12 8v4l3 3"
                            />
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M12 19a9 9 0 100-18 9 9 0 000 18z"
                            />
                        </svg>
                        {pendingDeposits + pendingDeductions} pending
                    </span>
                )}
            </div>

            {/* Tip */}
            <p className="mt-4 text-emerald-100/70 text-xs">
                Deposit funds to play quizzes and win prizes.
            </p>

            <span className="sr-only">
                Current wallet balance is {balance.toFixed(2)} PKR.
                {hasPending
                    ? ` There are ${pendingDeposits + pendingDeductions} pending transactions.`
                    : ' No pending transactions.'}
            </span>
        </section>
    );
}
