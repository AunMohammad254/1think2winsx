'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { memo, useMemo } from 'react';

// Floating cricket element component
const FloatingElement = memo(({
    children,
    delay = 0,
    duration = 6,
    x = 0,
    y = 0
}: {
    children: React.ReactNode;
    delay?: number;
    duration?: number;
    x?: number;
    y?: number;
}) => (
    <motion.div
        className="absolute pointer-events-none select-none"
        style={{ left: `${x}%`, top: `${y}%` }}
        initial={{ opacity: 0, scale: 0 }}
        animate={{
            opacity: [0.3, 0.6, 0.3],
            scale: [0.8, 1.1, 0.8],
            y: [0, -20, 0],
            rotate: [0, 10, -10, 0]
        }}
        transition={{
            duration,
            delay,
            repeat: Infinity,
            ease: "easeInOut"
        }}
    >
        {children}
    </motion.div>
));
FloatingElement.displayName = 'FloatingElement';

// 3D Cricket Ball component
const CricketBall = memo(() => (
    <motion.div
        className="relative w-48 h-48 md:w-64 md:h-64 lg:w-80 lg:h-80"
        initial={{ scale: 0, rotateY: -180 }}
        animate={{ scale: 1, rotateY: 0 }}
        transition={{ duration: 0.8, delay: 0.4, type: "spring", stiffness: 100 }}
    >
        {/* Glow effect */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[var(--color-accent)]/30 to-[var(--color-primary)]/20 blur-2xl animate-pulse" />

        {/* Main ball */}
        <motion.div
            className="relative w-full h-full rounded-full"
            style={{
                background: 'radial-gradient(circle at 30% 30%, #dc2626 0%, #991b1b 50%, #7f1d1d 100%)',
                boxShadow: `
          inset -20px -20px 40px rgba(0,0,0,0.4),
          inset 10px 10px 30px rgba(255,255,255,0.2),
          0 20px 60px rgba(0,0,0,0.5),
          0 0 80px rgba(var(--color-accent-rgb), 0.3)
        `
            }}
            animate={{
                rotateZ: [0, 360],
            }}
            transition={{
                duration: 20,
                repeat: Infinity,
                ease: "linear"
            }}
        >
            {/* Seam lines */}
            <div className="absolute inset-4 rounded-full border-2 border-white/20"
                style={{
                    borderStyle: 'dashed',
                    transform: 'rotateX(60deg) rotateZ(20deg)'
                }}
            />
            <div className="absolute inset-4 rounded-full border-2 border-white/20"
                style={{
                    borderStyle: 'dashed',
                    transform: 'rotateX(60deg) rotateZ(-20deg)'
                }}
            />

            {/* Highlight */}
            <div
                className="absolute top-[15%] left-[20%] w-[25%] h-[20%] rounded-full"
                style={{
                    background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.6) 0%, transparent 70%)'
                }}
            />
        </motion.div>
    </motion.div>
));
CricketBall.displayName = 'CricketBall';

// Main HeroSection component
const HeroSection = memo(() => {
    const { data: session, status } = useSession();
    const isLoading = status === 'loading';
    const isLoggedIn = !!session?.user;

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
        <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-gradient-to-br from-[var(--color-accent)] via-slate-900 to-black">
            {/* Animated Background Gradient */}
            <div className="absolute inset-0 overflow-hidden">
                <motion.div
                    className="absolute -top-1/2 -left-1/2 w-full h-full rounded-full opacity-30"
                    style={{
                        background: 'radial-gradient(circle, var(--color-primary) 0%, transparent 70%)'
                    }}
                    animate={{
                        scale: [1, 1.2, 1],
                        rotate: [0, 90, 0]
                    }}
                    transition={{
                        duration: 15,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                />
                <motion.div
                    className="absolute -bottom-1/2 -right-1/2 w-full h-full rounded-full opacity-20"
                    style={{
                        background: 'radial-gradient(circle, var(--color-secondary) 0%, transparent 70%)'
                    }}
                    animate={{
                        scale: [1.2, 1, 1.2],
                        rotate: [90, 0, 90]
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

            {/* Main Content */}
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
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

                    {/* Visual Element - Cricket Ball */}
                    <motion.div
                        className="flex-shrink-0 relative"
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
            </div>

            {/* Bottom gradient fade */}
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-gray-900 to-transparent pointer-events-none" />
        </section>
    );
});

HeroSection.displayName = 'HeroSection';

export default HeroSection;
