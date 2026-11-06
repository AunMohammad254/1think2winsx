import Link from 'next/link';
import { ArrowLeft, Star } from 'lucide-react';
import { requireAdminSession } from '@/lib/admin-session';
import ReviewsManager from '@/components/admin/ReviewsManager';

export default async function AdminReviewsPage() {
    // Require valid admin session (validates token in database)
    await requireAdminSession();

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
            <header className="sticky top-0 z-40 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center gap-4 py-4">
                        <Link
                            href="/admin/dashboard"
                            aria-label="Back to dashboard"
                            className="p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-gradient-to-r from-amber-500/20 to-yellow-500/20">
                                <Star className="w-6 h-6 text-amber-400" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-white">Player Reviews</h1>
                                <p className="text-gray-400 text-sm">Approve the reviews that appear on the home page</p>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <ReviewsManager />
            </main>
        </div>
    );
}
