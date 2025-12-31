import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Gift } from 'lucide-react';
import { requireAdminSession } from '@/lib/admin-session';
import PlayerClaimsManager from '@/components/admin/PlayerClaimsManager';

async function checkAuth() {
    // Require valid admin session (validates token in database)
    await requireAdminSession();
}

export default async function AdminClaimsPage() {
    await checkAuth();

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center gap-4 py-4">
                        <Link
                            href="/admin/dashboard"
                            className="p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/20">
                                <Gift className="w-6 h-6 text-amber-400" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-white">Prize Claims</h1>
                                <p className="text-gray-400 text-sm">Review and process player reward claims</p>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <PlayerClaimsManager />
            </main>
        </div>
    );
}
