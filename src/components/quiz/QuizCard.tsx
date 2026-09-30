'use client';

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
}

export default function QuizCard({
    id,
    title,
    duration,
    questionCount,
    status,
    isCompleted,
    onStartClick,
    pushStatus,
}: QuizCardProps) {
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
            <div className="qmeta">{questionCount} questions · {duration} min</div>
        </div>
    );
}
