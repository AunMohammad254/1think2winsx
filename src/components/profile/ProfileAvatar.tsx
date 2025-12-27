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
            {/* Avatar Circle */}
            <div className={`${sizeClasses[size]} rounded-full overflow-hidden bg-gradient-to-br from-purple-500 to-blue-500 shadow-2xl shadow-purple-500/25 border-4 border-white/10`}>
                {imageSrc ? (
                    <Image
                        src={imageSrc}
                        alt={name}
                        width={128}
                        height={128}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className={`w-full h-full flex items-center justify-center text-white font-bold ${textSizeClasses[size]}`}>
                        {getInitials(name)}
                    </div>
                )}
            </div>

            {/* Name */}
            <h2 className="mt-4 text-2xl font-bold text-white">{name}</h2>

            {/* User ID */}
            {userId && (
                <p className="mt-1 text-slate-400 text-sm">@{userId}</p>
            )}
        </div>
    );
}
