'use client';

import { formatDistanceToNow } from 'date-fns';
import { User, Trophy, ArrowRight } from 'lucide-react';
import type { RecentActivity } from '@/actions/dashboard-actions';

interface RecentActivityFeedProps {
    activities: RecentActivity[];
}

export default function RecentActivityFeed({ activities }: RecentActivityFeedProps) {
    if (activities.length === 0) {
        return (
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                    <User className="w-12 h-12 mb-3 opacity-50" />
                    <p>No recent activity</p>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl">
            <div className="p-6 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Recent Activity</h3>
                    <span className="text-sm text-gray-500">Last 30 days</span>
                </div>
            </div>

            <div className="divide-y divide-white/5">
                {activities.map((activity) => (
                    <ActivityItem key={activity.id} activity={activity} />
                ))}
            </div>
        </div>
    );
}

function ActivityItem({ activity }: { activity: RecentActivity }) {
    const isQuizAttempt = activity.type === 'quiz_attempt';

    return (
        <div className="p-4 hover:bg-white/5 transition-colors">
            <div className="flex items-start gap-4">
                {/* Icon */}
                <div className={`p-2 rounded-xl ${isQuizAttempt
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-green-500/20 text-green-400'
                    }`}>
                    {isQuizAttempt ? (
                        <Trophy className="w-5 h-5" />
                    ) : (
                        <User className="w-5 h-5" />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <div>
                            <p className="text-sm text-white font-medium truncate">
                                {activity.userName || activity.userEmail.split('@')[0]}
                            </p>
                            <p className="text-sm text-gray-400 mt-0.5">
                                {isQuizAttempt ? (
                                    <>
                                        Completed <span className="text-purple-400">{activity.quizTitle}</span>
                                        {activity.score !== null && (
                                            <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-purple-500/20 text-purple-300">
                                                Score: {activity.score}%
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    'Joined the platform'
                                )}
                            </p>
                        </div>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                            {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Skeleton version
export function RecentActivityFeedSkeleton() {
    return (
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl">
            <div className="p-6 border-b border-white/10">
                <div className="h-6 w-32 bg-gray-700/50 rounded animate-pulse" />
            </div>
            <div className="divide-y divide-white/5">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="p-4">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 bg-gray-700/50 rounded-xl animate-pulse" />
                            <div className="flex-1 space-y-2">
                                <div className="h-4 w-24 bg-gray-700/50 rounded animate-pulse" />
                                <div className="h-3 w-48 bg-gray-700/50 rounded animate-pulse" />
                            </div>
                            <div className="h-3 w-16 bg-gray-700/50 rounded animate-pulse" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
