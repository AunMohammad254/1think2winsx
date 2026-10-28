import Link from 'next/link';
import { ArrowLeft, Radio } from 'lucide-react';
import { requireAdminSession } from '@/lib/admin-session';
import MatchConsole from '@/components/admin/matches/MatchConsole';

export default async function AdminMatchConsolePage({ params }: { params: Promise<{ id: string }> }) {
    await requireAdminSession();
    const { id } = await params;

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
            <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center gap-4 py-4">
                        <Link href="/admin/matches" aria-label="Back to the matches" className="p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div className="flex items-center gap-3">
                            <Radio className="w-6 h-6 text-red-400" />
                            <h1 className="text-xl font-bold text-white">Scorer console</h1>
                        </div>
                    </div>
                </div>
            </header>
            <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <MatchConsole matchId={id} />
            </main>
        </div>
    );
}
