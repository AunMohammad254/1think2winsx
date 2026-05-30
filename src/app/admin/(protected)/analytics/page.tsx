import { Suspense } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  TrendingUp,
  Users,
  Award,
  DollarSign,
  Activity,
  Layers,
  Archive,
  BarChart3
} from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { requireAdminSession } from '@/lib/admin-session';
import { getAnalyticsData, AnalyticsData } from '@/actions/analytics-actions';

async function checkAuth() {
  const adminEmail = await requireAdminSession();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { adminEmail, user };
}

// ============================================
// Interactive Dashboard Component
// ============================================
async function AnalyticsDashboardContent() {
  const data: AnalyticsData = await getAnalyticsData();

  // Helper for generating SVG path for line chart
  const maxRevenue = Math.max(...data.revenue.map((r) => r.amount), 100);
  const chartHeight = 200;
  const chartWidth = 700;
  const padding = 40;

  const points = data.revenue.map((r, i) => {
    const x = padding + (i * (chartWidth - padding * 2)) / (data.revenue.length - 1);
    const y = chartHeight - padding - (r.amount * (chartHeight - padding * 2)) / maxRevenue;
    return { x, y, date: r.date, amount: r.amount };
  });

  const linePath = points.reduce((path, p, i) => {
    return i === 0 ? `M ${p.x} ${p.y}` : `${path} L ${p.x} ${p.y}`;
  }, '');

  // Fill path for area chart gradient
  const areaPath = points.length > 0 
    ? `${linePath} L ${points[points.length - 1].x} ${chartHeight - padding} L ${points[0].x} ${chartHeight - padding} Z`
    : '';

  // Calculate some simple totals
  const totalRevSum = data.revenue.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="space-y-8">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1 */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-400 text-sm">Monthly Revenue</p>
              <h3 className="text-2xl font-bold text-white mt-1">PKR {totalRevSum.toLocaleString()}</h3>
              <p className="text-emerald-400 text-xs mt-2 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" /> Live 30-day sum
              </p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Card 2 */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-400 text-sm">User Stickiness</p>
              <h3 className="text-2xl font-bold text-white mt-1">{data.retention.stickiness}%</h3>
              <p className="text-blue-400 text-xs mt-2 flex items-center gap-1">
                <Activity className="w-3.5 h-3.5" /> DAU / MAU Ratio
              </p>
            </div>
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Users className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Card 3 */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-400 text-sm">Funnel Completion</p>
              <h3 className="text-2xl font-bold text-white mt-1">
                {data.funnel[1]?.percentage || 0}%
              </h3>
              <p className="text-purple-400 text-xs mt-2 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" /> Started to Completed
              </p>
            </div>
            <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Layers className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Card 4 */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-400 text-sm">Prizes Awarded</p>
              <h3 className="text-2xl font-bold text-white mt-1">PKR {data.prizes.totalClaimedValue.toLocaleString()}</h3>
              <p className="text-green-400 text-xs mt-2 flex items-center gap-1">
                <Award className="w-3.5 h-3.5" /> Approved redemptions
              </p>
            </div>
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400">
              <Award className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Revenue line chart - Takes 2 columns */}
        <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold text-white">Daily Revenue (Last 30 Days)</h3>
              <p className="text-xs text-gray-400">Trend of completed user entry payments</p>
            </div>
            <span className="px-3 py-1 text-xs rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
              PKR
            </span>
          </div>

          {/* SVG Line Chart */}
          <div className="w-full overflow-hidden">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-auto overflow-visible"
            >
              {/* Gradients */}
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="50%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line x1={padding} y1={padding} x2={chartWidth - padding} y2={padding} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              <line x1={padding} y1={chartHeight / 2} x2={chartWidth - padding} y2={chartHeight / 2} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              <line x1={padding} y1={chartHeight - padding} x2={chartWidth - padding} y2={chartHeight - padding} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />

              {/* Area Under Line */}
              {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}

              {/* Trend Line */}
              {linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="url(#lineGrad)"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Points & Tooltips (represented cleanly on svg) */}
              {points.map((p, idx) => (
                <g key={idx} className="group cursor-pointer">
                  {p.amount > 0 && (
                    <>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={4}
                        className="fill-purple-500 stroke-white stroke-2 transition-all duration-200 group-hover:r-6"
                      />
                      {/* Interactive Tooltip Card overlay on hover */}
                      <g className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <rect
                          x={p.x - 60}
                          y={p.y - 45}
                          width={120}
                          height={35}
                          rx={6}
                          fill="#1e1b4b"
                          stroke="#4338ca"
                          strokeWidth={1}
                        />
                        <text
                          x={p.x}
                          y={p.y - 32}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="9"
                          fontWeight="bold"
                        >
                          PKR {p.amount.toLocaleString()}
                        </text>
                        <text
                          x={p.x}
                          y={p.y - 20}
                          textAnchor="middle"
                          fill="#94a3b8"
                          fontSize="7"
                        >
                          {p.date}
                        </text>
                      </g>
                    </>
                  )}
                </g>
              ))}

              {/* Left Y Axis Label */}
              <text x={padding - 5} y={padding + 5} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize={8}>
                PKR {maxRevenue.toLocaleString()}
              </text>
              <text x={padding - 5} y={chartHeight - padding + 3} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize={8}>
                0
              </text>

              {/* X Axis Labels (Dates) */}
              {points.filter((_, i) => i % 5 === 0 || i === points.length - 1).map((p, idx) => (
                <text
                  key={idx}
                  x={p.x}
                  y={chartHeight - padding + 15}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.4)"
                  fontSize={8}
                >
                  {p.date.split('-').slice(1).join('/')}
                </text>
              ))}
            </svg>
          </div>
        </div>

        {/* Quiz funnel - Takes 1 column */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-white mb-2">Quiz Conversion Funnel</h3>
            <p className="text-xs text-gray-400 mb-6">Process drop-offs for the past 30 days</p>

            <div className="space-y-6">
              {data.funnel.map((stage, idx) => (
                <div key={idx} className="relative">
                  <div className="flex justify-between items-center mb-2 z-10 relative">
                    <span className="text-sm font-medium text-gray-200">{stage.stage}</span>
                    <span className="text-sm font-bold text-white">
                      {stage.count.toLocaleString()} <span className="text-xs text-gray-400 font-normal">({stage.percentage}%)</span>
                    </span>
                  </div>
                  {/* Progress bar representing funnel depth */}
                  <div className="h-4 bg-gray-800/80 border border-white/5 rounded-lg overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${idx === 0
                        ? 'from-blue-500 to-indigo-500'
                        : idx === 1
                          ? 'from-purple-500 to-pink-500'
                          : 'from-emerald-500 to-teal-500'
                        } rounded-lg`}
                      style={{ width: `${stage.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 p-4 rounded-xl bg-purple-500/5 border border-purple-500/10 text-xs text-purple-300">
            🏏 <strong>Insight:</strong> Out of all players who start a quiz attempt,{' '}
            <span className="font-bold text-white">{data.funnel[1]?.percentage || 0}%</span> finish answering all questions.
          </div>
        </div>
      </div>

      {/* Row 3: Retention cohorts and Prize stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Retention cohorts table */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
          <h3 className="text-lg font-bold text-white mb-2">Registration Cohorts & Retention</h3>
          <p className="text-xs text-gray-400 mb-6">Percentage of weekly signups who played quizzes</p>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-gray-400 text-left">
                  <th className="pb-3 font-semibold">Cohort</th>
                  <th className="pb-3 font-semibold text-center">Registered</th>
                  <th className="pb-3 font-semibold text-center">Active (Quiz Played)</th>
                  <th className="pb-3 font-semibold text-right">Retention Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.retention.cohorts.map((cohort, idx) => (
                  <tr key={idx} className="hover:bg-white/5">
                    <td className="py-4 text-white font-medium">{cohort.cohortName}</td>
                    <td className="py-4 text-center text-gray-300">{cohort.registered.toLocaleString()}</td>
                    <td className="py-4 text-center text-gray-300">{cohort.active.toLocaleString()}</td>
                    <td className="py-4 text-right">
                      <span className={`inline-flex px-2.5 py-1 text-xs font-semibold rounded-full ${cohort.rate >= 70
                        ? 'text-green-400 bg-green-500/10 border border-green-500/20'
                        : cohort.rate >= 40
                          ? 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20'
                          : 'text-red-400 bg-red-500/10 border border-red-500/20'
                        }`}>
                        {cohort.rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Prize breakdown */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
          <h3 className="text-lg font-bold text-white mb-2">Prizes & Redemptions Breakdown</h3>
          <p className="text-xs text-gray-400 mb-6">Stock levels by category vs redemptions status</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            {/* Left Col: Stock by Category */}
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-1.5">
                <Archive className="w-4 h-4 text-blue-400" /> Stock by Category
              </h4>
              <div className="space-y-4">
                {data.prizes.stockByCategory.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-sm">
                    <span className="text-gray-400 capitalize">{item.category}</span>
                    <span className="font-bold text-white bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded text-xs">
                      {item.stock} items
                    </span>
                  </div>
                ))}
                {data.prizes.stockByCategory.length === 0 && (
                  <p className="text-xs text-gray-500">No prize stocks available.</p>
                )}
              </div>
            </div>

            {/* Right Col: Redemption Statuses */}
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-purple-400" /> Redemptions Status
              </h4>
              <div className="space-y-4">
                {data.prizes.redemptionsByStatus.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-sm">
                    <span className="text-gray-400 capitalize">{item.status}</span>
                    <span className={`font-bold px-2.5 py-0.5 rounded text-xs ${item.status === 'approved'
                      ? 'text-green-400 bg-green-500/10 border border-green-500/20'
                      : item.status === 'pending'
                        ? 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20'
                        : 'text-red-400 bg-red-500/10 border border-red-500/20'
                      }`}>
                      {item.count} claims
                    </span>
                  </div>
                ))}
                {data.prizes.redemptionsByStatus.length === 0 && (
                  <p className="text-xs text-gray-500">No prize redemptions requested yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Page Skeleton Loading
// ============================================
function AnalyticsSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 h-72 rounded-2xl border border-white/10 bg-white/5" />
        <div className="h-72 rounded-2xl border border-white/10 bg-white/5" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="h-60 rounded-2xl border border-white/10 bg-white/5" />
        <div className="h-60 rounded-2xl border border-white/10 bg-white/5" />
      </div>
    </div>
  );
}

// ============================================
// Main Page Export
// ============================================
export default async function AdminAnalyticsPage() {
  const { adminEmail } = await checkAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-4">
              <Link
                href="/admin/dashboard"
                className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Back to dashboard"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-white">Analytics Dashboard</h1>
                <p className="text-gray-400 text-sm">System performance metrics and user stats</p>
              </div>
            </div>
            <div className="hidden sm:block text-right">
              <p className="text-xs text-gray-500">Authenticated as</p>
              <p className="text-sm font-semibold text-purple-400">{adminEmail}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense fallback={<AnalyticsSkeleton />}>
          <AnalyticsDashboardContent />
        </Suspense>
      </main>
    </div>
  );
}
