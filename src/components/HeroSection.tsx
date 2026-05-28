'use client';

import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { memo, useMemo, useRef } from 'react';
import { FloatingElement, CricketBall } from './hero';

// Main HeroSection component
const HeroSection = memo(() => {
    const { user, isLoading } = useAuth();
    const isLoggedIn = !!user;

    const sectionRef = useRef<HTMLDivElement>(null);

    const prefersReduced = useReducedMotion();

    const { scrollYProgress } = useScroll({
        target: sectionRef,
        offset: ["start start", "end start"]
    });
    const heroY = useTransform(scrollYProgress, [0, 1], [0, 120]);
    const ballY = useTransform(scrollYProgress, [0, 1], [0, -80]);

    // Animation variants
    const containerVariants = useMemo(() => ({
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.15,
                delayChildren: 0.1
            }
        }
    }), []);

    const textVariants = useMemo(() => ({
        hidden: { opacity: 0, y: 30 },
        visible: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.6, ease: [0.0, 0.0, 0.2, 1] as const }
        }
    }), []);

    const buttonVariants = useMemo(() => ({
        hidden: { opacity: 0, y: 40, scale: 0.9 },
        visible: {
            opacity: 1,
            y: 0,
            scale: 1,
            transition: { duration: 0.5, ease: [0.0, 0.0, 0.2, 1] as const }
        }
    }), []);

    // CTA configuration based on auth state
    const ctaConfig = useMemo(() => {
        if (isLoading) {
            return { href: '/quizzes', text: 'Start Quiz Now', icon: '🎯' };
        }
        if (isLoggedIn) {
            return { href: '/quizzes', text: 'Play Now', icon: '🚀' };
        }
        return { href: '/register', text: 'Sign Up', icon: '✨' };
    }, [isLoading, isLoggedIn]);

    return (
        <section ref={sectionRef} className="relative min-h-[90vh] flex items-center overflow-hidden bg-gradient-to-br from-[var(--color-accent)] via-slate-900 to-black">
            {/* Animated Gradient Mesh Background — disabled when prefers-reduced-motion */}
            <div className="absolute inset-0 overflow-hidden">
                <motion.div
                    className="absolute -top-1/4 -left-1/4 w-[80%] h-[80%] rounded-full opacity-25"
                    style={{
                        background: 'radial-gradient(circle, var(--color-primary) 0%, transparent 70%)'
                    }}
                    animate={prefersReduced ? {} : {
                        scale: [1, 1.3, 0.9, 1.1, 1],
                        rotate: [0, 60, 120, 180, 360],
                        x: [0, 30, -20, 10, 0],
                        y: [0, -20, 30, -10, 0],
                    }}
                    transition={{
                        duration: 25,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                />
                <motion.div
                    className="absolute -bottom-1/4 -right-1/4 w-[80%] h-[80%] rounded-full opacity-20"
                    style={{
                        background: 'radial-gradient(circle, var(--color-secondary) 0%, transparent 70%)'
                    }}
                    animate={prefersReduced ? {} : {
                        scale: [1.2, 0.9, 1.1, 0.8, 1.2],
                        rotate: [0, -60, -120, -180, -360],
                        x: [0, -30, 20, -10, 0],
                        y: [0, 30, -20, 10, 0],
                    }}
                    transition={{
                        duration: 30,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                />
                <motion.div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] rounded-full opacity-15"
                    style={{
                        background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)'
                    }}
                    animate={prefersReduced ? {} : {
                        scale: [0.8, 1.2, 0.9, 1.1, 0.8],
                        rotate: [0, 90, 180, 270, 360],
                    }}
                    transition={{
                        duration: 20,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                />
            </div>

            {/* Floating Cricket Elements - Hidden on mobile for performance */}
            <div className="hidden md:block absolute inset-0 overflow-hidden">
                <FloatingElement x={5} y={15} delay={0} duration={8}>
                    <span className="text-4xl opacity-40">🏏</span>
                </FloatingElement>
                <FloatingElement x={85} y={10} delay={1.5} duration={7}>
                    <span className="text-3xl opacity-30">🏆</span>
                </FloatingElement>
                <FloatingElement x={10} y={70} delay={2} duration={9}>
                    <span className="text-5xl opacity-25">🎯</span>
                </FloatingElement>
                <FloatingElement x={90} y={60} delay={0.5} duration={6}>
                    <span className="text-4xl opacity-35">⚡</span>
                </FloatingElement>
                <FloatingElement x={50} y={5} delay={3} duration={10}>
                    <span className="text-3xl opacity-20">🌟</span>
                </FloatingElement>
                <FloatingElement x={75} y={80} delay={1} duration={8}>
                    <span className="text-4xl opacity-30">🎮</span>
                </FloatingElement>
            </div>

            {/* Main Content with Parallax */}
            <motion.div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10" style={{ y: heroY }}>
                <div className="flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-16">

                    {/* Text Content */}
                    <motion.div
                        className="flex-1 text-center lg:text-left max-w-2xl"
                        variants={containerVariants}
                        initial="hidden"
                        animate="visible"
                    >
                        {/* Badge */}
                        <motion.div variants={textVariants} className="mb-6">
                            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-primary)]/20 border border-[var(--color-primary)]/30 text-[var(--color-primary)] text-sm font-medium backdrop-blur-sm">
                                <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-pulse" />
                                Live Quizzes Available
                            </span>
                        </motion.div>

                        {/* Headline */}
                        <motion.h1
                            variants={textVariants}
                            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black leading-tight mb-6"
                        >
                            <span className="bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
                                Test Your
                            </span>
                            <br />
                            <span className="bg-gradient-to-r from-[var(--color-primary)] via-emerald-400 to-[var(--color-secondary)] bg-clip-text text-transparent">
                                Cricket Knowledge
                            </span>
                            <br />
                            <span className="bg-gradient-to-r from-[var(--color-secondary)] via-amber-400 to-orange-500 bg-clip-text text-transparent">
                                & Win Big!
                            </span>
                        </motion.h1>

                        {/* Sub-headline */}
                        <motion.p
                            variants={textVariants}
                            className="text-lg sm:text-xl md:text-2xl text-gray-300 leading-relaxed mb-8 max-w-xl mx-auto lg:mx-0"
                        >
                            Compete with fans worldwide, climb the leaderboard, and unlock
                            <span className="text-[var(--color-secondary)] font-semibold"> exclusive rewards</span>.
                        </motion.p>

                        {/* CTA Buttons */}
                        <motion.div
                            variants={buttonVariants}
                            className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start"
                        >
                            <Link href={ctaConfig.href}>
                                <motion.button
                                    className="group relative px-8 py-4 bg-gradient-to-r from-[var(--color-primary)] to-emerald-500 text-white rounded-2xl font-bold text-lg shadow-2xl shadow-[var(--color-primary)]/30 overflow-hidden"
                                    whileHover={{ scale: 1.05, boxShadow: '0 25px 50px -12px rgba(var(--color-primary-rgb), 0.5)' }}
                                    whileTap={{ scale: 0.98 }}
                                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                                >
                                    {/* Shimmer effect */}
                                    <motion.div
                                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                                        initial={{ x: '-100%' }}
                                        animate={{ x: '100%' }}
                                        transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                                    />
                                    <span className="relative z-10 flex items-center gap-2 justify-center">
                                        {ctaConfig.icon} {ctaConfig.text}
                                        <motion.span
                                            className="inline-block"
                                            animate={{ x: [0, 5, 0] }}
                                            transition={{ duration: 1.5, repeat: Infinity }}
                                        >
                                            →
                                        </motion.span>
                                    </span>
                                </motion.button>
                            </Link>

                            <Link href="/how-to-play">
                                <motion.button
                                    className="px-8 py-4 border-2 border-white/30 bg-white/5 backdrop-blur-sm text-white rounded-2xl font-bold text-lg"
                                    whileHover={{
                                        scale: 1.05,
                                        borderColor: 'rgba(255,255,255,0.5)',
                                        backgroundColor: 'rgba(255,255,255,0.1)'
                                    }}
                                    whileTap={{ scale: 0.98 }}
                                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                                >
                                    <span className="flex items-center gap-2 justify-center">
                                        📚 How to Play
                                    </span>
                                </motion.button>
                            </Link>
                        </motion.div>

                        {/* Stats Row */}
                        <motion.div
                            variants={textVariants}
                            className="mt-12 grid grid-cols-3 gap-4 sm:gap-8 max-w-md mx-auto lg:mx-0"
                        >
                            {[
                                { value: '10K+', label: 'Players' },
                                { value: '₹50K+', label: 'Prizes Won' },
                                { value: '500+', label: 'Quizzes' }
                            ].map((stat, index) => (
                                <motion.div
                                    key={index}
                                    className="text-center"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.8 + index * 0.1 }}
                                >
                                    <div className="text-2xl sm:text-3xl font-black text-white">{stat.value}</div>
                                    <div className="text-xs sm:text-sm text-gray-400">{stat.label}</div>
                                </motion.div>
                            ))}
                        </motion.div>
                    </motion.div>

                    {/* Visual Element - Cricket Ball with Parallax */}
                    <motion.div
                        className="flex-shrink-0 relative"
                        style={{ y: ballY }}
                        initial={{ opacity: 0, x: 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.8, delay: 0.3 }}
                    >
                        {/* Glassmorphism Card behind ball */}
                        <div className="absolute inset-0 -m-8 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 hidden lg:block" />

                        <CricketBall />

                        {/* Floating badges around ball */}
                        <motion.div
                            className="absolute -top-4 -right-4 px-3 py-1.5 bg-[var(--color-secondary)] rounded-full text-sm font-bold text-black shadow-lg"
                            initial={{ scale: 0, rotate: -20 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ delay: 1, type: "spring" }}
                        >
                            🏆 Win Prizes!
                        </motion.div>

                        <motion.div
                            className="absolute -bottom-2 -left-4 px-3 py-1.5 bg-[var(--color-primary)] rounded-full text-sm font-bold text-white shadow-lg"
                            initial={{ scale: 0, rotate: 20 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ delay: 1.2, type: "spring" }}
                        >
                            ⚡ Live Now
                        </motion.div>
                    </motion.div>
                </div>
            </motion.div>

            {/* Bottom gradient fade */}
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-gray-900 to-transparent pointer-events-none" />
        </section>
    );
});

HeroSection.displayName = 'HeroSection';

export default HeroSection;
