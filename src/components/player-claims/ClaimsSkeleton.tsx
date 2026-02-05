'use client';

/**
 * Loading skeleton for claims list
 */
export function ClaimsSkeleton() {
    return (
        <div className="space-y-4">
            {[1, 2, 3].map((i) => (
                <div key={i} className="p-6 rounded-xl border border-white/10 bg-white/5 animate-pulse">
                    <div className="flex items-center gap-4">
                        <div className="h-14 w-14 bg-white/10 rounded-full" />
                        <div className="flex-1 space-y-2">
                            <div className="h-4 bg-white/10 rounded w-1/3" />
                            <div className="h-3 bg-white/10 rounded w-1/2" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
