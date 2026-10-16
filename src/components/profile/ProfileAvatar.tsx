'use client';

import Image from 'next/image';

interface ProfileAvatarProps {
    imageSrc?: string | null;
    name: string;
    userId?: string;
    size?: 'sm' | 'md' | 'lg';
    /** When set, the avatar circle becomes a button (with a camera badge) that calls this. */
    onClick?: () => void;
    /** Accessible name for the button, e.g. "Update profile picture". */
    actionLabel?: string;
}

export default function ProfileAvatar({
    imageSrc,
    name,
    userId,
    size = 'lg',
    onClick,
    actionLabel = 'Update profile picture',
}: ProfileAvatarProps) {
    const sizeClasses = {
        sm: 'w-16 h-16',
        md: 'w-24 h-24',
        lg: 'w-32 h-32'
    };

    const textSizeClasses = {
        sm: 'text-xl',
        md: 'text-2xl',
        lg: 'text-4xl'
    };

    const ringClasses = {
        sm: 'ring-2 ring-emerald-400/40',
        md: 'ring-2 ring-emerald-400/40',
        lg: 'ring-4 ring-emerald-400/30'
    };

    const badgeClasses = {
        sm: 'w-6 h-6',
        md: 'w-8 h-8',
        lg: 'w-9 h-9'
    };

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    const circle = (
        <div
            className={`${sizeClasses[size]} ${ringClasses[size]} rounded-full overflow-hidden bg-gradient-to-br from-emerald-700 to-teal-700 shadow-xl shadow-emerald-900/30`}
            role={onClick ? undefined : 'img'}
            aria-label={onClick ? undefined : `${name}'s profile avatar`}
        >
            {imageSrc ? (
                <Image
                    src={imageSrc}
                    alt={name}
                    width={128}
                    height={128}
                    unoptimized
                    className="w-full h-full object-cover"
                />
            ) : (
                <div
                    className={`w-full h-full flex items-center justify-center text-white font-bold ${textSizeClasses[size]}`}
                    aria-hidden="true"
                >
                    {getInitials(name)}
                </div>
            )}
        </div>
    );

    return (
        <div className="flex flex-col items-center text-center">
            {onClick ? (
                // The button wraps only the avatar circle, so the overlay and badge line up with it exactly.
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={actionLabel}
                    className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                >
                    {circle}

                    {/* Hover / keyboard-focus veil, exactly the size of the avatar */}
                    <span
                        className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
                        aria-hidden="true"
                    >
                        <CameraIcon className="w-7 h-7 text-white" />
                    </span>

                    {/* Always-visible badge so the action is discoverable on touch screens too */}
                    <span
                        className={`pointer-events-none absolute bottom-0 right-0 ${badgeClasses[size]} flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg ring-2 ring-slate-900 transition-transform duration-200 group-hover:scale-110`}
                        aria-hidden="true"
                    >
                        <CameraIcon className="w-1/2 h-1/2" />
                    </span>
                </button>
            ) : (
                circle
            )}

            <h2 className="mt-4 text-2xl font-bold text-white">{name}</h2>

            {userId && (
                <p className="mt-1 text-slate-400 text-sm font-mono">@{userId}</p>
            )}
        </div>
    );
}

function CameraIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
    );
}
