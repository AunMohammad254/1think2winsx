'use client';

import { useOptimistic, useTransition } from 'react';
import { toggleQuizStatus } from '@/actions/dashboard-actions';
import { toast } from 'sonner';

interface StatusToggleProps {
    quizId: string;
    currentStatus: string;
    disabled?: boolean;
}

export default function StatusToggle({ quizId, currentStatus, disabled }: StatusToggleProps) {
    const [isPending, startTransition] = useTransition();
    const [optimisticStatus, setOptimisticStatus] = useOptimistic(currentStatus);

    const isActive = optimisticStatus === 'active';

    const handleToggle = () => {
        const newStatus = isActive ? 'paused' : 'active';

        startTransition(async () => {
            // Optimistic update
            setOptimisticStatus(newStatus);

            const result = await toggleQuizStatus(quizId, newStatus);

            if (!result.success) {
                // Revert on error
                toast.error(result.error);
            } else {
                toast.success(result.message);
            }
        });
    };

    return (
        <button
            onClick={handleToggle}
            disabled={disabled || isPending || currentStatus === 'draft'}
            className={`
                relative inline-flex h-6 w-11 items-center rounded-full
                transition-colors duration-200 ease-in-out
                focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900
                ${isActive ? 'bg-green-600' : 'bg-gray-600'}
                ${(disabled || isPending || currentStatus === 'draft') ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
            title={currentStatus === 'draft' ? 'Publish quiz first' : isActive ? 'Click to pause' : 'Click to activate'}
        >
            <span
                className={`
                    inline-block h-4 w-4 transform rounded-full bg-white
                    transition-transform duration-200 ease-in-out
                    ${isActive ? 'translate-x-6' : 'translate-x-1'}
                    ${isPending ? 'animate-pulse' : ''}
                `}
            />
        </button>
    );
}
