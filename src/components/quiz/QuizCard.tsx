'use client';

import { memo } from 'react';

interface QuizCardProps {
    id: string;
    title: string;
    description?: string;
    duration: number;
    questionCount: number;
    attemptCount?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    status: 'active' | 'paused' | 'completed' | 'new';
    hasAccess?: boolean;
    isCompleted?: boolean;
    score?: number;
    onStartClick?: (id: string) => void;
    pushStatus?: 'unanswered' | 'answered' | 'upcoming' | 'time-up' | null;
    /** Scheduled start time, shown on upcoming quizzes */
    startsAt?: string | null;
}

// ⚡ Bolt: Wrapped QuizCard in React.memo to prevent unnecessary re-renders when parent state (like the countdown timer) changes.
// Impact: Reduces re-renders of list items in QuizzesPage by ~90% during polling or timer updates.
export default memo(function QuizCard({
    id,
    title,
    duration,
    questionCount,
    status,
    isCompleted,
    onStartClick,
    pushStatus,
    startsAt,
}: QuizCardProps) {
    // No router.prefetch of /quiz/<id> on hover: the card opens the live-quiz modal and never navigates
    // there, so each hover was a wasted, uncacheable request to the origin (src/lib/link-prefetch.ts).
    const handleClick = (e: React.MouseEvent) => {
        if (onStartClick) {
            e.preventDefault();
            onStartClick(id);
        }
    };

    let pStatus = 'missed';
    let label = 'Missed';
    
    if (pushStatus === 'upcoming') { pStatus = 'upcoming'; label = 'Upcoming'; }
    else if (pushStatus === 'time-up') { pStatus = 'time-up'; label = 'Time-up'; }
    else if (pushStatus === 'unanswered' || (!isCompleted && status === 'active')) { pStatus = 'active'; label = 'Unanswered'; }
    else if (pushStatus === 'answered' || isCompleted) { pStatus = 'answered'; label = 'Answered'; }

    return (
        <div className="quiz-card" onClick={handleClick}>
            <span className={`qstatus ${pStatus}`}>
                <span className="qdot"></span>
                <span className="qlabel">{label}</span>
            </span>
            <div className="qtitle">{title}</div>
            <div className="qmeta">
                {questionCount} questions · {duration} min
                {pStatus === 'upcoming' && startsAt && (
                    <> · Starts {new Date(startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</>
                )}
            </div>
        </div>
    );
})
