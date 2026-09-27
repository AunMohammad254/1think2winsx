'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Clock,
    Target,
    AlertCircle,
    CheckCircle2,
    CreditCard,
    RefreshCcw,
    Wallet,
    Trophy,
    Star,
    TrendingUp,
    Medal,
    Crown
} from 'lucide-react';

interface RuleItem {
    icon: React.ReactNode;
    title: string;
    description: string;
}

const quizRules: RuleItem[] = [
    {
        icon: <Clock className="w-5 h-5" />,
        title: "10 Minutes Time Limit",
        description: "Complete all questions within the allocated time to be eligible for prizes."
    },
    {
        icon: <Target className="w-5 h-5" />,
        title: "One Attempt Per Quiz",
        description: "Each user gets a single attempt per quiz to maintain fairness."
    },
    {
        icon: <CheckCircle2 className="w-5 h-5" />,
        title: "Answer All Questions",
        description: "You must complete all questions to be entered into the prize draw."
    },
    {
        icon: <AlertCircle className="w-5 h-5" />,
        title: "Auto-Save Progress",
        description: "Your answers are saved automatically if you lose connection."
    },
];

const paymentRules: RuleItem[] = [
    {
        icon: <CreditCard className="w-5 h-5" />,
        title: "Entry Fee: 2 PKR",
        description: "Minimal investment for a chance to win amazing prizes worth thousands!"
    },
    {
        icon: <Wallet className="w-5 h-5" />,
        title: "Secure Payment",
        description: "All transactions are processed through secure, encrypted payment gateways."
    },
    {
        icon: <RefreshCcw className="w-5 h-5" />,
        title: "Non-Refundable",
        description: "Entry fees are non-refundable once the quiz starts as per our terms."
    },
    {
        icon: <Trophy className="w-5 h-5" />,
        title: "24-Hour Access",
        description: "One payment gives you access to participate in quizzes for 24 hours."
    },
];

const pointsRules: RuleItem[] = [
    {
        icon: <Star className="w-5 h-5" />,
        title: "Performance Points",
        description: "Earn points based on correct answers and completion time."
    },
    {
        icon: <TrendingUp className="w-5 h-5" />,
        title: "Bonus Points",
        description: "Top 10% performers in each quiz receive bonus points."
    },
    {
        icon: <Medal className="w-5 h-5" />,
        title: "Leaderboard Rankings",
        description: "Accumulate points to climb the global leaderboard."
    },
    {
        icon: <Crown className="w-5 h-5" />,
        title: "Redeem Rewards",
        description: "Use your points to redeem exclusive prizes and rewards."
    },
];

const tabs = [
    { id: 'quiz', label: 'Quiz Rules', icon: Target, rules: quizRules },
    { id: 'payment', label: 'Payment & Fees', icon: CreditCard, rules: paymentRules },
    { id: 'points', label: 'Points System', icon: Trophy, rules: pointsRules },
];

export default function RulesTabs() {
    const [activeTab, setActiveTab] = useState('quiz');

    const currentRules = tabs.find(t => t.id === activeTab)?.rules || quizRules;

    return (
        <div className="w-full">
            {/* Tab Headers */}
            <div className="flex flex-wrap justify-center gap-2 sm:gap-4 mb-8">
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;

                    return (
                        <motion.button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className={`relative px-4 sm:px-6 py-3 rounded-xl font-semibold text-sm sm:text-base transition-all duration-300 flex items-center gap-2
                ${isActive
                                    ? 'text-white'
                                    : 'text-gray-400 hover:text-gray-200 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50'
                                }
              `}
                        >
                            {isActive && (
                                <motion.div
                                    layoutId="activeTab"
                                    className="absolute inset-0 bg-gradient-to-r from-emerald-600 to-teal-500 rounded-xl shadow-lg shadow-emerald-500/25"
                                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                />
                            )}
                            <span className="relative flex items-center gap-2">
                                <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                                <span className="hidden sm:inline">{tab.label}</span>
                                <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
                            </span>
                        </motion.button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                >
                    {currentRules.map((rule, index) => (
                        <motion.div
                            key={rule.title}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="group relative overflow-hidden"
                        >
                            {/* Card */}
                            <div className="relative h-full p-5 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-emerald-500/30 transition-all duration-300">
                                {/* Icon */}
                                <div className="flex items-start gap-4">
                                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform duration-300">
                                        {rule.icon}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-white font-semibold mb-1 text-sm sm:text-base font-[family-name:var(--font-poppins)]">
                                            {rule.title}
                                        </h4>
                                        <p className="text-gray-400 text-xs sm:text-sm leading-relaxed">
                                            {rule.description}
                                        </p>
                                    </div>
                                </div>

                                {/* Hover Gradient */}
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                            </div>
                        </motion.div>
                    ))}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
