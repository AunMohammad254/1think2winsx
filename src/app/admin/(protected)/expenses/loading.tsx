export default function ExpenseManagerLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-4 sm:p-6 lg:p-8 animate-pulse">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header Skeleton */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-4 w-32 bg-white/10 rounded-md" />
            <div className="h-8 w-64 bg-white/10 rounded-xl" />
            <div className="h-4 w-96 bg-white/5 rounded-md" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-28 bg-white/10 rounded-xl" />
            <div className="h-10 w-24 bg-white/10 rounded-xl" />
            <div className="h-10 w-32 bg-white/10 rounded-xl" />
          </div>
        </div>

        {/* KPI Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-2xl bg-white/5 border border-white/10 p-5 space-y-3"
            >
              <div className="h-3 w-24 bg-white/10 rounded" />
              <div className="h-7 w-36 bg-white/10 rounded-lg" />
            </div>
          ))}
        </div>

        {/* Filter bar Skeleton */}
        <div className="h-16 rounded-2xl bg-white/5 border border-white/10" />

        {/* Subscription cards Skeleton */}
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-64 rounded-2xl bg-white/5 border border-white/10 p-6 space-y-4"
            >
              <div className="h-8 w-1/3 bg-white/10 rounded" />
              <div className="h-16 w-full bg-white/[0.03] rounded-xl" />
              <div className="h-16 w-full bg-white/[0.03] rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

