export interface ChoiceOption {
    value: string;
    label: string;
    color: string;
}

export const difficultyOptions: ChoiceOption[] = [
    { value: 'easy', label: 'Easy', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    { value: 'medium', label: 'Medium', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    { value: 'hard', label: 'Hard', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
];

export const statusOptions: ChoiceOption[] = [
    { value: 'draft', label: 'Draft', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
    { value: 'active', label: 'Published', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    { value: 'paused', label: 'Paused', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    { value: 'scheduled', label: 'Scheduled', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    { value: 'upcoming', label: 'Upcoming', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
];

// Statuses that go live on their own at `startsAt`, so they need a date.
export const isTimedStatus = (status?: string) => status === 'scheduled' || status === 'upcoming';
