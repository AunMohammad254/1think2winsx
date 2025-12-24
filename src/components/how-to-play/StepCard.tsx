'use client';

import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface StepCardProps {
    step: number;
    title: string;
    description: string;
    icon: LucideIcon;
    delay?: number;
}

export default function StepCard({ step, title, description, icon: Icon, delay = 0 }: StepCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay }}
            className="relative group"
        >
            {/* Connecting Line (hidden on mobile, first item, or last in row) */}
            <div className="hidden lg:block absolute top-12 left-[60%] w-full h-0.5 bg-gradient-to-r from-emerald-500/50 to-transparent -z-10 group-last:hidden" />

            <div className="flex flex-col items-center text-center p-4 sm:p-6">
                {/* Step Number Badge */}
                <motion.div
                    whileHover={{ scale: 1.1 }}
                    transition={{ type: "spring", stiffness: 400 }}
                    className="relative mb-4"
                >
                    {/* Glow Effect */}
                    <div className="absolute inset-0 bg-emerald-500/30 rounded-full blur-xl animate-pulse" />

                    {/* Main Circle */}
                    <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-400 p-1 shadow-lg shadow-emerald-500/30">
                        <div className="w-full h-full rounded-full bg-slate-900/90 backdrop-blur-sm flex items-center justify-center">
                            <Icon className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-400" strokeWidth={1.5} />
                        </div>
                    </div>

                    {/* Step Number */}
                    <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                        <span className="text-slate-900 font-bold text-sm">{step}</span>
                    </div>
                </motion.div>

                {/* Title */}
                <h3 className="text-lg sm:text-xl font-bold text-white mb-2 font-[family-name:var(--font-poppins)]">
                    {title}
                </h3>

                {/* Description */}
                <p className="text-gray-400 text-sm sm:text-base max-w-[200px]">
                    {description}
                </p>
            </div>
        </motion.div>
    );
}
