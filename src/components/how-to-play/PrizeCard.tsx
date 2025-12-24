'use client';

import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface PrizeCardProps {
    name: string;
    description: string;
    icon: LucideIcon;
    tier: 'grand' | 'major' | 'standard';
    value?: string;
    delay?: number;
}

const tierStyles = {
    grand: {
        gradient: 'from-amber-400 via-yellow-300 to-amber-500',
        glow: 'shadow-amber-500/40',
        border: 'border-amber-400/50',
        bg: 'from-slate-900 via-slate-800 to-slate-900',
        badge: 'bg-gradient-to-r from-amber-400 to-yellow-300 text-slate-900',
        iconColor: 'text-amber-400',
    },
    major: {
        gradient: 'from-emerald-400 via-teal-300 to-emerald-500',
        glow: 'shadow-emerald-500/30',
        border: 'border-emerald-400/50',
        bg: 'from-slate-900 via-slate-800 to-slate-900',
        badge: 'bg-gradient-to-r from-emerald-400 to-teal-300 text-slate-900',
        iconColor: 'text-emerald-400',
    },
    standard: {
        gradient: 'from-blue-400 via-cyan-300 to-blue-500',
        glow: 'shadow-blue-500/30',
        border: 'border-blue-400/50',
        bg: 'from-slate-900 via-slate-800 to-slate-900',
        badge: 'bg-gradient-to-r from-blue-400 to-cyan-300 text-slate-900',
        iconColor: 'text-blue-400',
    },
};

export default function PrizeCard({ name, description, icon: Icon, tier, value, delay = 0 }: PrizeCardProps) {
    const styles = tierStyles[tier];

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay }}
            whileHover={{ scale: 1.03, y: -8 }}
            className={`relative group cursor-pointer ${tier === 'grand' ? 'col-span-1 sm:col-span-2 lg:col-span-2' : ''}`}
        >
            {/* Outer Glow on Hover */}
            <div className={`absolute -inset-0.5 bg-gradient-to-r ${styles.gradient} rounded-2xl opacity-0 group-hover:opacity-75 blur-lg transition-all duration-500 ${styles.glow}`} />

            {/* Card Container */}
            <div className={`relative h-full bg-gradient-to-br ${styles.bg} rounded-2xl border ${styles.border} backdrop-blur-xl overflow-hidden`}>
                {/* Decorative Pattern */}
                <div className="absolute inset-0 opacity-5">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-white to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-white to-transparent rounded-full translate-y-1/2 -translate-x-1/2" />
                </div>

                {/* Content */}
                <div className={`relative p-6 sm:p-8 ${tier === 'grand' ? 'flex flex-col sm:flex-row items-center gap-6' : 'text-center'}`}>
                    {/* Icon Container */}
                    <motion.div
                        whileHover={{ rotate: [0, -10, 10, 0] }}
                        transition={{ duration: 0.5 }}
                        className={`relative ${tier === 'grand' ? 'flex-shrink-0' : 'mx-auto'} mb-4 ${tier === 'grand' ? 'sm:mb-0' : ''}`}
                    >
                        {/* Icon Glow */}
                        <div className={`absolute inset-0 bg-gradient-to-r ${styles.gradient} rounded-full opacity-20 blur-xl scale-150`} />

                        {/* Icon Circle */}
                        <div className={`relative w-16 h-16 sm:w-20 sm:h-20 ${tier === 'grand' ? 'lg:w-24 lg:h-24' : ''} rounded-full bg-gradient-to-r ${styles.gradient} p-0.5`}>
                            <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center">
                                <Icon className={`w-8 h-8 sm:w-10 sm:h-10 ${tier === 'grand' ? 'lg:w-12 lg:h-12' : ''} ${styles.iconColor}`} strokeWidth={1.5} />
                            </div>
                        </div>
                    </motion.div>

                    {/* Text Content */}
                    <div className={tier === 'grand' ? 'text-center sm:text-left flex-1' : ''}>
                        {/* Prize Badge */}
                        {tier === 'grand' && (
                            <span className={`inline-block ${styles.badge} text-xs font-bold px-3 py-1 rounded-full mb-2`}>
                                🏆 GRAND PRIZE
                            </span>
                        )}

                        {/* Prize Name */}
                        <h3 className={`text-xl sm:text-2xl ${tier === 'grand' ? 'lg:text-3xl' : ''} font-bold text-white mb-2 font-[family-name:var(--font-poppins)]`}>
                            {name}
                        </h3>

                        {/* Description */}
                        <p className="text-gray-400 text-sm sm:text-base mb-3">
                            {description}
                        </p>

                        {/* Value Tag */}
                        {value && (
                            <div className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-to-r ${styles.gradient} bg-opacity-20`}>
                                <span className={`font-bold text-sm ${styles.iconColor}`}>
                                    {value}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Shimmer Effect on Hover */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
            </div>
        </motion.div>
    );
}
