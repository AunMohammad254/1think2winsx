'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Trophy,
    Shuffle,
    CheckCircle2,
    AlertTriangle,
    ChevronRight,
    Users,
    Star,
    Clock,
    Fingerprint,
    Medal,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================
interface PrizeLinkedQuiz {
    id: string;
    title: string;
    status: string;
    prizeId: string;
    isBumperPrize: boolean;
    prize: { id: string; name: string; description: string | null; imageUrl: string | null } | null;
}

interface Attempt {
    id: string;
    userId: string;
    score: number;
    completedAt: string;
    user: { id: string; name: string; email: string; phone?: string } | null;
}

interface ExistingWinner {
    id: string;
    userId: string;
    score: number;
    selectionMethod: string;
    seed: string;
    selectedAt: string;
    selectedBy: string | null;
    user: { id: string; name: string; email: string } | null;
}

interface LeaderboardData {
    quiz: PrizeLinkedQuiz;
    prize: { id: string; name: string } | null;
    totalAttempts: number;
    maxScore: number;
    tiedCount: number;
    tiedTopAttempts: Attempt[];
    leaderboard: Attempt[];
    existingWinner: ExistingWinner | null;
    winnerAlreadyDrawn: boolean;
}

interface DrawResult {
    success: boolean;
    message: string;
    winner: {
        id: string;
        userId: string;
        name: string;
        email?: string;
        score: number;
        selectionMethod: string;
        seed: string;
        selectedAt: string;
    };
    draw: {
        totalAttempts: number;
        maxScore: number;
        tiedCount: number;
        selectedIndex: number | null;
        seed: string;
    };
}

// ============================================================================
// Sub-components
// ============================================================================
function StepBadge({ step, label, active, done }: { step: number; label: string; active: boolean; done: boolean }) {
    return (
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
            done ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
            active ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' :
            'bg-gray-800/50 text-gray-500 border border-gray-700/50'
        }`}>
            {done ? <CheckCircle2 className="w-4 h-4" /> : (
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                    active ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-400'
                }`}>{step}</span>
            )}
            {label}
        </div>
    );
}

function WinnerCard({ winner, seed, method }: { winner: DrawResult['winner']; seed: string; method: string }) {
    return (
        <div className="bg-gradient-to-br from-yellow-900/30 to-amber-900/20 border border-yellow-500/40 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 bg-yellow-500/20 rounded-full flex items-center justify-center">
                    <Trophy className="w-6 h-6 text-yellow-400" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">🎉 Winner Selected!</h3>
                    <p className="text-yellow-300/70 text-sm">
                        {method === 'auto_single_winner' ? 'Single top scorer — no draw needed' : 'Fair random draw from tied candidates'}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div className="bg-black/30 rounded-xl p-4">
                    <p className="text-gray-400 text-xs mb-1">Winner</p>
                    <p className="text-white font-semibold text-lg">{winner.name}</p>
                    {winner.email && <p className="text-gray-400 text-sm">{winner.email}</p>}
                </div>
                <div className="bg-black/30 rounded-xl p-4">
                    <p className="text-gray-400 text-xs mb-1">Score</p>
                    <p className="text-yellow-300 font-bold text-2xl">{winner.score}</p>
                </div>
            </div>

            {/* Audit trail */}
            <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                <div className="flex items-center gap-2 mb-3">
                    <Fingerprint className="w-4 h-4 text-gray-400" />
                    <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Audit Trail</p>
                </div>
                <p className="text-gray-500 text-xs font-mono break-all">Seed: {seed}</p>
                <p className="text-gray-500 text-xs mt-1">Selected at: {new Date(winner.selectedAt).toLocaleString()}</p>
            </div>
        </div>
    );
}

// ============================================================================
// Main Component
// ============================================================================
export default function LuckyWinnerManager() {
    const [step, setStep] = useState(1); // 1=select quiz, 2=leaderboard, 3=draw, 4=result
    const [quizzes, setQuizzes] = useState<PrizeLinkedQuiz[]>([]);
    const [selectedQuizId, setSelectedQuizId] = useState<string>('');
    const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
    const [drawResult, setDrawResult] = useState<DrawResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingQuizzes, setLoadingQuizzes] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);

    // Fetch prize-linked quizzes
    const fetchPrizeQuizzes = useCallback(async () => {
        try {
            setLoadingQuizzes(true);
            const res = await fetch('/api/admin/quizzes');
            if (!res.ok) throw new Error('Failed to fetch quizzes');
            const data = await res.json();
            const prizeQuizzes = (data.quizzes || []).filter((q: any) => q.prizeId);
            setQuizzes(prizeQuizzes);
        } catch (err) {
            setError('Failed to load quizzes');
        } finally {
            setLoadingQuizzes(false);
        }
    }, []);

    useEffect(() => {
        fetchPrizeQuizzes();
    }, [fetchPrizeQuizzes]);

    // Load leaderboard for selected quiz
    const loadLeaderboard = useCallback(async (quizId: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/lucky-winner/${quizId}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load leaderboard');
            setLeaderboard(data);

            // If winner already drawn, jump to result
            if (data.winnerAlreadyDrawn && data.existingWinner) {
                setDrawResult({
                    success: true,
                    message: 'Winner was previously drawn.',
                    winner: {
                        id: data.existingWinner.id,
                        userId: data.existingWinner.userId,
                        name: data.existingWinner.user?.name ?? 'Unknown',
                        email: data.existingWinner.user?.email,
                        score: data.existingWinner.score,
                        selectionMethod: data.existingWinner.selectionMethod,
                        seed: data.existingWinner.seed,
                        selectedAt: data.existingWinner.selectedAt,
                    },
                    draw: {
                        totalAttempts: data.totalAttempts,
                        maxScore: data.maxScore,
                        tiedCount: data.tiedCount,
                        selectedIndex: null,
                        seed: data.existingWinner.seed,
                    },
                });
                setStep(4);
            } else {
                setStep(2);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load');
        } finally {
            setLoading(false);
        }
    }, []);

    const handleQuizSelect = (quizId: string) => {
        setSelectedQuizId(quizId);
        loadLeaderboard(quizId);
    };

    // Run the draw
    const runDraw = async () => {
        if (!selectedQuizId) return;
        setLoading(true);
        setError(null);
        setConfirming(false);
        try {
            const res = await fetch(`/api/admin/lucky-winner/${selectedQuizId}/draw`, {
                method: 'POST',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Draw failed');
            setDrawResult(data);
            setStep(4);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Draw failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const reset = () => {
        setStep(1);
        setSelectedQuizId('');
        setLeaderboard(null);
        setDrawResult(null);
        setError(null);
        setConfirming(false);
    };

    return (
        <div className="space-y-6">
            {/* Step indicators */}
            <div className="flex flex-wrap gap-2">
                <StepBadge step={1} label="Select Quiz" active={step === 1} done={step > 1} />
                <ChevronRight className="w-4 h-4 text-gray-600 self-center" />
                <StepBadge step={2} label="Leaderboard" active={step === 2} done={step > 2} />
                <ChevronRight className="w-4 h-4 text-gray-600 self-center" />
                <StepBadge step={3} label="Run Draw" active={step === 3} done={step > 3} />
                <ChevronRight className="w-4 h-4 text-gray-600 self-center" />
                <StepBadge step={4} label="Result" active={step === 4} done={false} />
            </div>

            {/* Error banner */}
            {error && (
                <div className="flex items-start gap-3 bg-red-900/30 border border-red-500/40 rounded-xl p-4">
                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-300 text-sm">{error}</p>
                </div>
            )}

            {/* Step 1: Quiz selection */}
            {step === 1 && (
                <div className="bg-gray-900/50 border border-white/10 rounded-2xl p-6">
                    <h2 className="text-xl font-bold text-white mb-2">Select a Prize-Linked Quiz</h2>
                    <p className="text-gray-400 text-sm mb-6">
                        Only quizzes with a linked prize are shown below.
                        Link a prize to a quiz in the Quiz Management page first.
                    </p>

                    {loadingQuizzes ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="h-16 bg-gray-800/50 rounded-xl animate-pulse" />
                            ))}
                        </div>
                    ) : quizzes.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p className="font-medium">No prize-linked quizzes found.</p>
                            <p className="text-sm mt-1">Go to Quiz Management → edit a quiz → link a prize.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {quizzes.map(quiz => (
                                <button
                                    key={quiz.id}
                                    onClick={() => handleQuizSelect(quiz.id)}
                                    disabled={loading && selectedQuizId === quiz.id}
                                    className="w-full text-left bg-gray-800/40 hover:bg-gray-800/70 border border-white/10 hover:border-yellow-500/40 rounded-xl p-4 transition-all group"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-yellow-500/15 flex items-center justify-center flex-shrink-0">
                                                <Trophy className="w-5 h-5 text-yellow-400" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-white group-hover:text-yellow-300 transition-colors">
                                                    {quiz.title}
                                                </p>
                                                <p className="text-sm text-gray-400">
                                                    Prize: {quiz.prize?.name ?? quiz.prizeId}
                                                    {quiz.isBumperPrize && (
                                                        <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-xs rounded">
                                                            Bumper
                                                        </span>
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                            quiz.status === 'active' ? 'bg-green-500/20 text-green-300' : 'bg-gray-700/50 text-gray-400'
                                        }`}>
                                            {quiz.status}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Step 2: Leaderboard */}
            {step === 2 && leaderboard && (
                <div className="space-y-6">
                    {/* Stats row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {[
                            { icon: <Users className="w-5 h-5" />, label: 'Total Attempts', value: leaderboard.totalAttempts, color: 'blue' },
                            { icon: <Star className="w-5 h-5" />, label: 'Top Score', value: leaderboard.maxScore, color: 'yellow' },
                            { icon: <Medal className="w-5 h-5" />, label: 'Tied at Top', value: leaderboard.tiedCount, color: leaderboard.tiedCount > 1 ? 'amber' : 'green' },
                            { icon: <Trophy className="w-5 h-5" />, label: 'Prize', value: leaderboard.prize?.name ?? '—', color: 'purple' },
                        ].map(({ icon, label, value, color }) => (
                            <div key={label} className={`bg-gray-900/50 border border-${color}-500/20 rounded-xl p-4`}>
                                <div className={`text-${color}-400 mb-2`}>{icon}</div>
                                <p className="text-gray-400 text-xs mb-1">{label}</p>
                                <p className="text-white font-bold text-lg truncate">{value}</p>
                            </div>
                        ))}
                    </div>

                    {/* Tied candidates highlight */}
                    {leaderboard.tiedCount > 1 && (
                        <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <AlertTriangle className="w-4 h-4 text-amber-400" />
                                <p className="text-amber-300 text-sm font-semibold">
                                    {leaderboard.tiedCount} candidates tied at {leaderboard.maxScore} points — a random draw will select one.
                                </p>
                            </div>
                            <div className="space-y-2">
                                {leaderboard.tiedTopAttempts.map((a, i) => (
                                    <div key={a.id} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2">
                                        <span className="text-white text-sm">
                                            #{i + 1} — {a.user?.name ?? a.userId}
                                        </span>
                                        <div className="flex items-center gap-2 text-gray-400 text-xs">
                                            <Clock className="w-3 h-3" />
                                            {new Date(a.completedAt).toLocaleString()}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Top 10 leaderboard */}
                    <div className="bg-gray-900/50 border border-white/10 rounded-2xl overflow-hidden">
                        <div className="p-4 border-b border-white/10">
                            <h3 className="font-semibold text-white">Top Scores — {leaderboard.quiz.title}</h3>
                        </div>
                        <div className="divide-y divide-white/5">
                            {leaderboard.leaderboard.slice(0, 10).map((a, i) => (
                                <div key={a.id} className={`flex items-center justify-between px-4 py-3 ${
                                    a.score === leaderboard.maxScore ? 'bg-yellow-500/5' : ''
                                }`}>
                                    <div className="flex items-center gap-3">
                                        <span className={`w-6 text-center font-bold text-sm ${
                                            i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-gray-500'
                                        }`}>
                                            #{i + 1}
                                        </span>
                                        <div>
                                            <p className="text-white text-sm font-medium">{a.user?.name ?? a.userId}</p>
                                            <p className="text-gray-500 text-xs">{a.user?.email}</p>
                                        </div>
                                    </div>
                                    <span className={`font-bold ${a.score === leaderboard.maxScore ? 'text-yellow-300' : 'text-gray-300'}`}>
                                        {a.score}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Action */}
                    <div className="flex gap-3">
                        <button
                            onClick={reset}
                            className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 transition-all text-sm"
                        >
                            ← Back
                        </button>
                        <button
                            onClick={() => setStep(3)}
                            disabled={leaderboard.totalAttempts === 0}
                            className="flex-1 py-3 bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 hover:to-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                            <Shuffle className="w-4 h-4" />
                            {leaderboard.tiedCount === 1 ? 'Confirm Single Winner' : `Run Fair Draw (${leaderboard.tiedCount} candidates)`}
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3: Confirm draw */}
            {step === 3 && leaderboard && (
                <div className="bg-gray-900/50 border border-white/10 rounded-2xl p-6 space-y-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-yellow-500/20 rounded-full flex items-center justify-center">
                            <Shuffle className="w-6 h-6 text-yellow-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Confirm Draw</h2>
                            <p className="text-gray-400 text-sm">This action is permanent and cannot be undone.</p>
                        </div>
                    </div>

                    <div className="bg-gray-800/50 rounded-xl p-4 space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-400">Quiz</span>
                            <span className="text-white font-medium">{leaderboard.quiz.title}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">Prize</span>
                            <span className="text-white font-medium">{leaderboard.prize?.name}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">Method</span>
                            <span className="text-white font-medium">
                                {leaderboard.tiedCount === 1 ? 'Auto (single top scorer)' : `Fair random draw from ${leaderboard.tiedCount} tied candidates`}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">Algorithm</span>
                            <span className="text-white font-mono text-xs">crypto.randomBytes(32) mod N</span>
                        </div>
                    </div>

                    <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-300">
                        ⚠️ Once confirmed, the winner is recorded permanently in the audit log. A notification will be sent to the winner immediately.
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={() => setStep(2)}
                            className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 transition-all text-sm"
                        >
                            ← Back
                        </button>
                        <button
                            onClick={runDraw}
                            disabled={loading}
                            className="flex-1 py-3 bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 hover:to-amber-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Drawing...
                                </>
                            ) : (
                                <>
                                    <Trophy className="w-4 h-4" />
                                    Confirm & Draw Winner
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* Step 4: Result */}
            {step === 4 && drawResult && (
                <div className="space-y-6">
                    <WinnerCard
                        winner={drawResult.winner}
                        seed={drawResult.draw.seed}
                        method={drawResult.winner.selectionMethod}
                    />

                    <div className="bg-gray-900/50 border border-white/10 rounded-xl p-4 text-sm text-gray-400 space-y-1">
                        <p>Total attempts: <span className="text-white">{drawResult.draw.totalAttempts}</span></p>
                        <p>Tied at top score ({drawResult.draw.maxScore}): <span className="text-white">{drawResult.draw.tiedCount}</span></p>
                        {drawResult.draw.selectedIndex !== null && (
                            <p>Selected index: <span className="text-white">{drawResult.draw.selectedIndex}</span> (from seed mod {drawResult.draw.tiedCount})</p>
                        )}
                    </div>

                    <button
                        onClick={reset}
                        className="w-full py-3 border border-white/10 text-gray-300 hover:bg-white/5 rounded-xl transition-all text-sm"
                    >
                        ← Draw for another quiz
                    </button>
                </div>
            )}
        </div>
    );
}
