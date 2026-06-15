'use client';

import Image from 'next/image';

interface ProfileAvatarProps {
    imageSrc?: string | null;
    name: string;
    userId?: string;
    size?: 'sm' | 'md' | 'lg';
}

export default function ProfileAvatar({
    imageSrc,
    name,
    userId,
    size = 'lg'
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

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <div className="flex flex-col items-center text-center">
            <div
                className={`${sizeClasses[size]} ${ringClasses[size]} rounded-full overflow-hidden bg-linear-to-br from-emerald-500 to-teal-600 shadow-xl shadow-emerald-900/30`}
                role="img"
                aria-label={`${name}'s profile avatar`}
            >
                {imageSrc ? (
                    <Image
                        src={imageSrc}
                        alt={name}
                        width={128}
                        height={128}
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

            <h2 className="mt-4 text-2xl font-bold text-white">{name}</h2>

            {userId && (
                <p className="mt-1 text-slate-400 text-sm font-mono">@{userId}</p>
            )}
        </div>
    );
}
