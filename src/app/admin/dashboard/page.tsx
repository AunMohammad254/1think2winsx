import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  CheckSquare,
  Trophy,
  Wallet,
  Video,
  Settings,
  Database,
  Shield,
  Gift,
  ChevronRight
} from 'lucide-react';

import { createClient } from '@/lib/supabase/server';

import { getDashboardStats, getRecentActivity } from '@/actions/dashboard-actions';
import KPICard, { KPICardSkeleton } from '@/components/admin/dashboard/KPICard';
import RecentActivityFeed, { RecentActivityFeedSkeleton } from '@/components/admin/dashboard/RecentActivityFeed';

// ============================================
// Auth Check
// ============================================
async function checkAuth() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  return session;
}

// ============================================
// Data Fetching Components with Suspense
// ============================================

async function DashboardKPIs() {
  const stats = await getDashboardStats();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KPICard
        title="Total Users"
        value={stats.totalUsers}
        subtitle={`+${stats.recentUsers} this week`}
        icon="users"
        color="purple"
      />
      <KPICard
        title="Active Quizzes"
        value={stats.activeQuizzes}
        subtitle={`${stats.totalQuizzes} total`}
        icon="quizzes"
        color="blue"
      />
      <KPICard
        title="Completion Rate"
        value={`${stats.completionRate}%`}
        subtitle={`${stats.completedAttempts} completed`}
        icon="completion"
        color="green"
      />
      <KPICard
        title="Total Revenue"
        value={`PKR ${stats.totalRevenue.toLocaleString()}`}
        subtitle="From completed payments"
        icon="revenue"
        color="yellow"
      />
    </div>
  );
}

function KPIsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <KPICardSkeleton key={i} />
      ))}
    </div>
  );
}

async function ActivityFeed() {
  const activities = await getRecentActivity(8);
  return <RecentActivityFeed activities={activities} />;
}

// ============================================
// Navigation Items
// ============================================
const navItems = [
  { href: '/admin/dashboard', label: 'Overview', icon: LayoutDashboard, active: true },
  { href: '/admin/quizzes', label: 'Quiz Management', icon: FileText },
  { href: '/admin/quiz', label: 'Create Quiz', icon: FileText },
  { href: '/admin/prizes', label: 'Prizes', icon: Gift },
  { href: '/admin/wallet', label: 'Wallet Deposits', icon: Wallet },
  { href: '/admin/claims', label: 'Prize Claims', icon: Trophy },
  { href: '/admin/streaming', label: 'Live Streaming', icon: Video },
  { href: '/admin/db-stats', label: 'Database', icon: Database },
  { href: '/admin/security', label: 'Security', icon: Shield },
];

const quickActions = [
  { href: '/admin/quiz', label: 'Create New Quiz', icon: FileText, color: 'purple' },
  { href: '/admin/quizzes', label: 'Manage Quizzes', icon: CheckSquare, color: 'blue' },
  { href: '/admin/prizes', label: 'Manage Prizes', icon: Trophy, color: 'green' },
  { href: '/admin/wallet', label: 'Wallet Deposits', icon: Wallet, color: 'emerald' },
  { href: '/admin/claims', label: 'Prize Claims', icon: Gift, color: 'amber' },
  { href: '/admin/streaming', label: 'Live Streaming', icon: Video, color: 'red' },
];

// ============================================
// Main Page Component
// ============================================
export default async function AdminDashboardPage() {
  const session = await checkAuth();
  const userName = session.user?.user_metadata?.name ||
    session.user?.user_metadata?.full_name ||
    session.user?.email?.split('@')[0] ||
    'Admin';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
              <p className="text-gray-400 text-sm">Welcome back, {userName}</p>
            </div>
            <div className="flex items-center gap-4">
              {navItems.slice(1, 4).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-sm"
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* KPI Cards */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Overview</h2>
          <Suspense fallback={<KPIsSkeleton />}>
            <DashboardKPIs />
          </Suspense>
        </section>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Activity - Takes 2 columns */}
          <section className="lg:col-span-2">
            <Suspense fallback={<RecentActivityFeedSkeleton />}>
              <ActivityFeed />
            </Suspense>
          </section>

          {/* Quick Actions - Takes 1 column */}
          <section className="space-y-6">
            {/* Quick Actions Card */}
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
              <div className="space-y-3">
                {quickActions.map((action) => (
                  <Link
                    key={action.href}
                    href={action.href}
                    className={`
                                            flex items-center justify-between p-4 rounded-xl
                                            bg-${action.color}-500/10 border border-${action.color}-500/20
                                            hover:bg-${action.color}-500/20 transition-colors group
                                        `}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg bg-${action.color}-500/20`}>
                        <action.icon className={`w-5 h-5 text-${action.color}-400`} />
                      </div>
                      <span className="font-medium text-white">{action.label}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
                  </Link>
                ))}
              </div>
            </div>

            {/* Navigation Links */}
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Navigation</h3>
              <nav className="space-y-2">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`
                                            flex items-center gap-3 px-4 py-3 rounded-xl transition-colors
                                            ${item.active
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }
                                        `}
                  >
                    <item.icon className="w-5 h-5" />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                ))}
              </nav>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}