'use client';

import LazySection from '@/components/LazySection';
import HeroSection from '@/components/HeroSection';
import Link from "next/link";
import { memo, useMemo, useState, useRef, useEffect } from 'react';
import { motion, useInView, Variants } from 'framer-motion';
import { UserPlus, BrainCircuit, Trophy, Bike, Smartphone, Headphones, Watch } from 'lucide-react';

const sectionVariants: Variants = {
    hidden: { opacity: 0, y: 40 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.6, ease: [0.0, 0.0, 0.2, 1] }
    }
};

const cardVariants: Variants = {
    hidden: { opacity: 0, y: 60, scale: 0.95 },
    visible: (delay: number) => ({
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { duration: 0.5, delay: delay * 0.15, ease: [0.0, 0.0, 0.2, 1] }
    })
};


function CountUp({ end, suffix = '', duration = 2 }: { end: number; suffix?: string; duration?: number }) {
    const [count, setCount] = useState(0);
    const ref = useRef<HTMLSpanElement>(null);
    const isInView = useInView(ref, { once: true });

    useEffect(() => {
        if (!isInView) return;
        let startTime: number | null = null;
        const step = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);
            setCount(Math.floor(progress * end));
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }, [isInView, end, duration]);

    return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

const StepCard = memo(({ title, description, gradient, delay, icon: Icon }: {
    title: string;
    description: string;
    gradient: string;
    delay: number;
    icon: React.ElementType;
}) => (
    <motion.div
        className="group relative"
        variants={cardVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
        custom={delay}
        whileHover={{ y: -8, scale: 1.03 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
        <motion.div
            className={`absolute inset-0 ${gradient} rounded-3xl blur-xl transition-all duration-500`}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ delay: delay * 0.15 + 0.3 }}
        />
        <div className="relative glass-card-blue p-8 rounded-3xl border border-blue-400/20 shadow-2xl">
            <div className="text-center space-y-6">
                <div className="relative mx-auto w-20 h-20 mb-6">
                    <motion.div
                        className="relative w-full h-full bg-white rounded-2xl flex items-center justify-center shadow-xl"
                        whileHover={{ rotate: 12 }}
                        transition={{ type: "spring", stiffness: 200 }}
                    >
                        <Icon className="w-10 h-10 text-blue-600" />
                    </motion.div>
                </div>
                <h3 className="text-2xl font-bold text-white mb-4">{title}</h3>
                <p className="text-gray-300 leading-relaxed" dangerouslySetInnerHTML={{ __html: description }} />
            </div>
        </div>
    </motion.div>
));
StepCard.displayName = 'StepCard';

const PrizeCard = memo(({ icon: Icon, title, description, gradient, badge, delay }: {
    icon: React.ElementType;
    title: string;
    description: string;
    gradient: string;
    badge: string;
    delay: number;
}) => (
    <motion.div
        className="group relative"
        variants={cardVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
        custom={delay}
        whileHover={{ y: -12, scale: 1.04 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
        <motion.div
            className={`absolute inset-0 ${gradient} rounded-3xl blur-xl transition-all duration-500`}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ delay: delay * 0.15 + 0.3 }}
        />
        <div className="relative glass-card-blue p-6 rounded-3xl border border-red-400/20 shadow-2xl">
            <div className="text-center space-y-4">
                <div className="relative mx-auto w-24 h-24 mb-4">
                    <motion.div
                        className="relative w-full h-full bg-white rounded-2xl flex items-center justify-center shadow-xl"
                        whileHover={{ rotate: 12 }}
                        transition={{ type: "spring", stiffness: 200 }}
                    >
                        <Icon className="w-12 h-12 text-blue-600" />
                    </motion.div>
                </div>
                <h3 className="text-2xl font-bold text-white">{title}</h3>
                <p className="text-gray-300 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: description }} />
                <div className="pt-2">
                    <motion.span
                        className={`inline-block px-4 py-2 ${gradient} rounded-full text-orange-300 text-sm font-semibold border border-orange-400/30`}
                        whileHover={{ scale: 1.1 }}
                        transition={{ type: "spring", stiffness: 400 }}
                    >
                        {badge}
                    </motion.span>
                </div>
            </div>
        </div>
    </motion.div>
));
PrizeCard.displayName = 'PrizeCard';

const StatCard = memo(({ end, suffix, display, label, color }: {
    end: number | null;
    suffix?: string;
    display?: string;
    label: string;
    color: string;
}) => (
    <motion.div
        className="group"
        initial={{ opacity: 0, y: 30, scale: 0.9 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        whileHover={{ scale: 1.06 }}
    >
        <div className={`glass-card-blue p-4 rounded-2xl border ${color} touch-manipulation`}>
            <div className={`text-2xl md:text-3xl font-black ${color.replace('border-', 'text-').replace('/20', '')} mb-1`}>
                {display || <CountUp end={end!} suffix={suffix} />}
            </div>
            <div className="text-sm text-gray-300">{label}</div>
        </div>
    </motion.div>
));
StatCard.displayName = 'StatCard';

export default function Home() {
    const stepData = useMemo(() => [
        {
            step: 1,
            title: "Register & Pay",
            description: 'Create an account and pay just <span class="font-bold text-cyan-300">2 PKR</span> to enter the quiz competition',
            gradient: "bg-gradient-to-r from-blue-600/20 to-cyan-600/20",
            delay: 0,
            icon: UserPlus
        },
        {
            step: 2,
            title: "Answer Questions",
            description: 'Test your cricket knowledge with our challenging <span class="font-bold text-pink-300">tape ball cricket</span> questions',
            gradient: "bg-gradient-to-r from-purple-600/20 to-pink-600/20",
            delay: 0.15,
            icon: BrainCircuit
        },
        {
            step: 3,
            title: "Win Prizes",
            description: 'Random winners are selected after each quiz session to win <span class="font-bold text-yellow-300">exciting prizes</span>!',
            gradient: "bg-gradient-to-r from-green-600/20 to-yellow-600/20",
            delay: 0.3,
            icon: Trophy
        }
    ], []);

    const prizeData = useMemo(() => [
        {
            icon: Bike,
            title: "Bike",
            description: 'Win a brand new motorcycle worth <span class="font-bold text-orange-300">PKR 150,000+</span>',
            gradient: "bg-gradient-to-r from-red-500/20 to-orange-500/20",
            badge: "Grand Prize",
            delay: 0
        },
        {
            icon: Smartphone,
            title: "Smartphone",
            description: 'Latest smartphone worth <span class="font-bold text-cyan-300">PKR 50,000+</span>',
            gradient: "bg-gradient-to-r from-blue-500/20 to-cyan-500/20",
            badge: "Premium Prize",
            delay: 0.15
        },
        {
            icon: Headphones,
            title: "Wireless Earbuds",
            description: 'Premium wireless earbuds worth <span class="font-bold text-pink-300">PKR 15,000+</span>',
            gradient: "bg-gradient-to-r from-purple-500/20 to-pink-500/20",
            badge: "Popular Prize",
            delay: 0.3
        },
        {
            icon: Watch,
            title: "Smart Watch",
            description: 'Advanced smartwatch worth <span class="font-bold text-emerald-300">PKR 25,000+</span>',
            gradient: "bg-gradient-to-r from-green-500/20 to-emerald-500/20",
            badge: "Tech Prize",
            delay: 0.45
        }
    ], []);

    const statsData = useMemo(() => [
        { end: 1000, suffix: "+", label: "Active Players", color: "border-blue-400/20" },
        { end: 10000, suffix: "+", label: "Prizes Won", color: "border-purple-400/20" },
        { end: 500, suffix: "+", label: "Quizzes Taken", color: "border-green-400/20" },
        { end: null, display: "24/7", label: "Available", color: "border-yellow-400/20" }
    ], []);

    return (
        <div className="flex flex-col overflow-hidden">
            <HeroSection />

            {/* How It Works Section */}
            <LazySection
                className="py-20 bg-gradient-to-br from-gray-900 via-blue-900/20 to-gray-900 relative overflow-hidden"
                rootMargin="100px"
                delay={50}
            >
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-blue-500/5 to-purple-500/5"></div>
                    <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-cyan-400/10 rounded-full blur-2xl"></div>
                    <div className="absolute bottom-1/4 right-1/4 w-40 h-40 bg-blue-400/10 rounded-full blur-2xl"></div>
                </div>

                {/* Connector line between steps */}
                <motion.div
                    className="hidden md:block absolute top-[45%] left-[15%] right-[15%] h-px z-0"
                    initial={{ scaleX: 0, opacity: 0 }}
                    whileInView={{ scaleX: 1, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, delay: 0.3 }}
                    style={{ transformOrigin: 'center' }}
                >
                    <div className="w-full h-full bg-gradient-to-r from-transparent via-blue-400/30 via-purple-400/30 to-transparent" />
                </motion.div>

                <div className="container mx-auto px-4 relative z-10">
                    <motion.div
                        className="text-center mb-16"
                        variants={sectionVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                    >
                        <h2 className="text-4xl md:text-6xl font-black mb-6">
                            <span className="bg-gradient-to-r from-white via-blue-200 to-cyan-300 bg-clip-text text-transparent">
                                How It Works
                            </span>
                        </h2>
                        <p className="text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
                            Simple steps to start your cricket quiz journey and win amazing prizes
                        </p>
                    </motion.div>

                    <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        {stepData.map((step) => (
                            <StepCard key={step.step} {...step} />
                        ))}
                    </div>
                </div>
            </LazySection>

            {/* Prize Showcase */}
            <LazySection
                className="py-20 bg-gradient-to-br from-gray-900 via-purple-900/10 to-gray-900 relative overflow-hidden"
                rootMargin="100px"
                delay={100}
            >
                <div className="absolute inset-0">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-l from-purple-500/10 to-transparent rounded-full blur-3xl hidden md:animate-pulse"></div>
                    <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-r from-blue-500/10 to-transparent rounded-full blur-3xl hidden md:animate-pulse md:delay-1000"></div>
                </div>

                <div className="container mx-auto px-4 relative z-10">
                    <motion.div
                        className="text-center mb-16"
                        variants={sectionVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                    >
                        <h2 className="text-4xl md:text-6xl font-black mb-6">
                            <span className="bg-gradient-to-r from-yellow-300 via-orange-300 to-red-400 bg-clip-text text-transparent">
                                Amazing Prizes
                            </span>
                        </h2>
                        <p className="text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
                            Win incredible prizes worth thousands of rupees in our cricket quiz competition
                        </p>
                    </motion.div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
                        {prizeData.map((prize, index) => (
                            <PrizeCard key={index} {...prize} />
                        ))}
                    </div>
                </div>
            </LazySection>

            {/* CTA Section */}
            <section className="py-20 bg-gradient-to-br from-blue-900 via-purple-900/30 to-blue-900 relative overflow-hidden">
                <div className="absolute inset-0">
                    <div className="absolute top-0 left-1/4 w-64 h-64 bg-gradient-to-r from-blue-400/10 to-cyan-400/10 rounded-full blur-3xl hidden md:animate-pulse"></div>
                    <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-gradient-to-l from-purple-400/10 to-pink-400/10 rounded-full blur-3xl hidden md:animate-pulse md:delay-1000"></div>
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-r from-cyan-400/5 to-blue-400/5 rounded-full blur-3xl hidden md:animate-pulse md:delay-500"></div>
                </div>

                <div className="absolute inset-0 md:hidden">
                    <div className="absolute top-0 left-1/4 w-32 h-32 bg-gradient-to-r from-blue-400/5 to-cyan-400/5 rounded-full"></div>
                    <div className="absolute bottom-0 right-1/4 w-32 h-32 bg-gradient-to-l from-purple-400/5 to-pink-400/5 rounded-full"></div>
                </div>

                <div className="container mx-auto px-4 text-center relative z-10">
                    <motion.div
                        className="max-w-4xl mx-auto space-y-8"
                        variants={sectionVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                    >
                        <div className="space-y-6">
                            <h2 className="text-4xl md:text-6xl font-black leading-tight">
                                <span className="bg-gradient-to-r from-white via-blue-100 to-cyan-200 bg-clip-text text-transparent">
                                    Ready to Test Your
                                </span>
                                <br />
                                <span className="bg-gradient-to-r from-cyan-200 via-blue-200 to-purple-200 bg-clip-text text-transparent">
                                    Cricket Knowledge?
                                </span>
                            </h2>
                            <p className="text-xl md:text-2xl text-gray-200 leading-relaxed max-w-2xl mx-auto">
                                Join thousands of cricket fans and compete for amazing prizes.
                                <span className="font-bold text-cyan-300"> Start your quiz journey today!</span>
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-6 justify-center items-center pt-8">
                            <Link
                                href="/register"
                                className="group relative px-10 py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-2xl font-bold text-xl shadow-2xl transform transition-all duration-300 active:scale-95 sm:hover:scale-110 sm:hover:shadow-cyan-500/25 sm:hover:shadow-2xl touch-manipulation"
                            >
                                <span className="relative z-10 flex items-center gap-3">
                                    <span>🚀 Register Now</span>
                                    <motion.span
                                        className="inline-block"
                                        animate={{ x: [0, 5, 0] }}
                                        transition={{ duration: 1.5, repeat: Infinity }}
                                    >
                                        →
                                    </motion.span>
                                </span>
                                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl opacity-0 md:group-hover:opacity-100 transition-opacity duration-300"></div>
                            </Link>

                            <div className="flex items-center gap-4 text-gray-300">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 bg-green-400 rounded-full hidden md:animate-pulse"></div>
                                    <span className="text-sm font-medium">Live Quiz Available</span>
                                </div>
                                <div className="w-px h-6 bg-gray-600"></div>
                                <div className="flex items-center gap-2">
                                    <span className="text-2xl">🏆</span>
                                    <span className="text-sm font-medium">Win Big Prizes</span>
                                </div>
                            </div>
                        </div>

                        {/* Stats Section */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-12 max-w-3xl mx-auto">
                            {statsData.map((stat, index) => (
                                <StatCard key={index} {...stat} />
                            ))}
                        </div>
                    </motion.div>
                </div>
            </section>
        </div>
    );
}
