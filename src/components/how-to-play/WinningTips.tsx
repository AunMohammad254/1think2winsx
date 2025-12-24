'use client';

import { motion } from 'framer-motion';
import { Timer, Wifi, Brain, LucideIcon } from 'lucide-react';

interface TipCardProps {
    icon: LucideIcon;
    title: string;
    description: string;
    color: 'emerald' | 'amber' | 'blue';
    delay?: number;
}

const colorStyles = {
    emerald: {
        gradient: 'from-emerald-500 to-teal-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/30',
        text: 'text-emerald-400',
        glow: 'group-hover:shadow-emerald-500/20',
    },
    amber: {
        gradient: 'from-amber-500 to-yellow-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/30',
        text: 'text-amber-400',
        glow: 'group-hover:shadow-amber-500/20',
    },
    blue: {
        gradient: 'from-blue-500 to-cyan-400',
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/30',
        text: 'text-blue-400',
        glow: 'group-hover:shadow-blue-500/20',
    },
};

function TipCard({ icon: Icon, title, description, color, delay = 0 }: TipCardProps) {
    const styles = colorStyles[color];

    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay }}
            whileHover={{ y: -5 }}
            className={`group relative overflow-hidden rounded-2xl ${styles.bg} border ${styles.border} p-6 transition-all duration-300 hover:shadow-xl ${styles.glow}`}
        >
            {/* Background Pattern */}
            <div className="absolute top-0 right-0 w-24 h-24 opacity-10">
                <div className={`w-full h-full bg-gradient-to-br ${styles.gradient} rounded-full blur-2xl`} />
            </div>

            {/* Icon */}
            <motion.div
                className={`relative w-14 h-14 rounded-xl bg-gradient-to-br ${styles.gradient} p-0.5 mb-4`}
                whileHover={{ rotate: 5, scale: 1.05 }}
                transition={{ type: "spring", stiffness: 400 }}
            >
                <div className="w-full h-full rounded-xl bg-slate-900 flex items-center justify-center">
                    <Icon className={`w-7 h-7 ${styles.text}`} strokeWidth={1.5} />
                </div>
            </motion.div>

            {/* Content */}
            <h3 className="text-lg sm:text-xl font-bold text-white mb-2 font-[family-name:var(--font-poppins)]">
                {title}
            </h3>
            <p className="text-gray-400 text-sm sm:text-base leading-relaxed">
                {description}
            </p>

            {/* Bottom Accent */}
            <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${styles.gradient} transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left`} />
        </motion.div>
    );
}

export default function WinningTips() {
    const tips = [
        {
            icon: Timer,
            title: "Manage Your Time",
            description: "Don't spend too long on tricky questions. Move on and come back if time permits.",
            color: 'emerald' as const,
        },
        {
            icon: Wifi,
            title: "Check Your Connection",
            description: "Ensure stable internet before starting. Your progress is auto-saved, but speed matters!",
            color: 'amber' as const,
        },
        {
            icon: Brain,
            title: "Know Your Cricket",
            description: "Stay updated with cricket news, stats, and history to boost your quiz performance.",
            color: 'blue' as const,
        },
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {tips.map((tip, index) => (
                <TipCard
                    key={tip.title}
                    icon={tip.icon}
                    title={tip.title}
                    description={tip.description}
                    color={tip.color}
                    delay={index * 0.15}
                />
            ))}
        </div>
    );
}
