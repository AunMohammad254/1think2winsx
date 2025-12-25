'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import LoginForm from '@/components/auth/LoginForm';
import RegisterForm from '@/components/auth/RegisterForm';

function AuthPageContent() {
    const searchParams = useSearchParams();
    const initialMode = searchParams.get('mode') === 'register';
    const [isLogin, setIsLogin] = useState(!initialMode);

    return (
        <div className="min-h-screen relative overflow-auto">
            {/* Animated Gradient Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950">
                {/* Mesh gradient overlay */}
                <div
                    className="absolute inset-0 opacity-30"
                    style={{
                        backgroundImage: `
              radial-gradient(at 40% 20%, hsla(280, 70%, 50%, 0.3) 0px, transparent 50%),
              radial-gradient(at 80% 0%, hsla(220, 70%, 50%, 0.2) 0px, transparent 50%),
              radial-gradient(at 0% 50%, hsla(340, 70%, 50%, 0.2) 0px, transparent 50%),
              radial-gradient(at 80% 50%, hsla(200, 70%, 50%, 0.15) 0px, transparent 50%),
              radial-gradient(at 0% 100%, hsla(280, 70%, 50%, 0.2) 0px, transparent 50%),
              radial-gradient(at 80% 100%, hsla(240, 70%, 50%, 0.15) 0px, transparent 50%)
            `,
                    }}
                />
                {/* Animated orbs - desktop only */}
                <div className="hidden md:block">
                    <motion.div
                        animate={{
                            x: [0, 50, 0],
                            y: [0, 30, 0],
                        }}
                        transition={{
                            duration: 20,
                            repeat: Infinity,
                            ease: 'easeInOut',
                        }}
                        className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-500/20 rounded-full blur-[100px]"
                    />
                    <motion.div
                        animate={{
                            x: [0, -30, 0],
                            y: [0, 50, 0],
                        }}
                        transition={{
                            duration: 25,
                            repeat: Infinity,
                            ease: 'easeInOut',
                        }}
                        className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-500/20 rounded-full blur-[100px]"
                    />
                    <motion.div
                        animate={{
                            x: [0, 40, 0],
                            y: [0, -40, 0],
                        }}
                        transition={{
                            duration: 18,
                            repeat: Infinity,
                            ease: 'easeInOut',
                        }}
                        className="absolute top-1/2 right-1/3 w-[300px] h-[300px] bg-pink-500/15 rounded-full blur-[80px]"
                    />
                </div>
                {/* Pattern overlay */}
                <div
                    className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                    }}
                />
            </div>

            {/* Main Content */}
            <div className="relative z-10 min-h-screen flex">
                {/* Left Side - Branding (Desktop) */}
                <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-12">
                    <motion.div
                        initial={{ opacity: 0, x: -50 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6 }}
                        className="max-w-md text-center"
                    >
                        {/* Logo */}
                        <Link href="/" className="inline-block mb-8 group">
                            <div className="relative">
                                <div className="absolute -inset-3 bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 rounded-full blur-lg opacity-60 group-hover:opacity-100 transition duration-300" />
                                <div className="relative">
                                    <Image
                                        src="/auth-logo.png"
                                        alt="Kheelo Or Jeeto Logo"
                                        width={100}
                                        height={100}
                                        className="rounded-full bg-white/10 backdrop-blur-xl p-2 border border-white/20 shadow-2xl transform group-hover:scale-110 transition-all duration-300"
                                    />
                                </div>
                            </div>
                        </Link>

                        {/* Title */}
                        <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 bg-clip-text text-transparent mb-6">
                            Kheelo Or Jeeto
                        </h1>
                        <p className="text-xl text-slate-300 mb-8 leading-relaxed">
                            Play exciting quizzes, test your knowledge, and win amazing prizes!
                        </p>

                        {/* Features */}
                        <div className="space-y-4 text-left">
                            {[
                                { emoji: '🎮', text: 'Daily quiz challenges' },
                                { emoji: '🏆', text: 'Win real prizes' },
                                { emoji: '📊', text: 'Track your progress' },
                                { emoji: '🌟', text: 'Compete on leaderboards' },
                            ].map((feature, idx) => (
                                <motion.div
                                    key={idx}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.3 + idx * 0.1 }}
                                    className="flex items-center gap-3 text-slate-300"
                                >
                                    <span className="text-xl">{feature.emoji}</span>
                                    <span>{feature.text}</span>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                </div>

                {/* Right Side - Auth Form */}
                <div className="w-full lg:w-1/2 flex flex-col lg:justify-center items-center p-6 md:p-12 py-8">
                    {/* Mobile Logo */}
                    <div className="lg:hidden mb-8">
                        <Link href="/" className="inline-block group">
                            <div className="relative">
                                <div className="absolute -inset-2 bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 rounded-full blur opacity-60" />
                                <Image
                                    src="/auth-logo.png"
                                    alt="Kheelo Or Jeeto Logo"
                                    width={70}
                                    height={70}
                                    className="relative rounded-full bg-white/10 backdrop-blur-xl p-1 border border-white/20 shadow-xl"
                                />
                            </div>
                        </Link>
                    </div>

                    {/* Form Container */}
                    <motion.div
                        layout
                        className="w-full max-w-md"
                    >
                        {/* Glassmorphism Card */}
                        <div className="relative">
                            {/* Glow effect */}
                            <div className="absolute -inset-1 bg-gradient-to-r from-purple-600/20 via-blue-600/20 to-pink-600/20 rounded-3xl blur-xl" />

                            {/* Card */}
                            <div className="relative bg-slate-900/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-8 overflow-hidden">
                                {/* Toggle Switch */}
                                <div className="flex justify-center mb-8">
                                    <div className="relative bg-slate-800/50 rounded-xl p-1 flex">
                                        <motion.div
                                            layoutId="authToggle"
                                            className="absolute inset-y-1 w-1/2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg shadow-lg"
                                            animate={{ x: isLogin ? 0 : '100%' }}
                                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                                        />
                                        <button
                                            onClick={() => setIsLogin(true)}
                                            className={`relative z-10 px-6 py-2.5 text-sm font-semibold rounded-lg transition-colors ${isLogin ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                                                }`}
                                        >
                                            Sign In
                                        </button>
                                        <button
                                            onClick={() => setIsLogin(false)}
                                            className={`relative z-10 px-6 py-2.5 text-sm font-semibold rounded-lg transition-colors ${!isLogin ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                                                }`}
                                        >
                                            Sign Up
                                        </button>
                                    </div>
                                </div>

                                {/* Sliding Forms */}
                                <div className="relative">
                                    <AnimatePresence mode="wait">
                                        {isLogin ? (
                                            <motion.div
                                                key="login"
                                                initial={{ x: -20, opacity: 0 }}
                                                animate={{ x: 0, opacity: 1 }}
                                                exit={{ x: 20, opacity: 0 }}
                                                transition={{ duration: 0.25, ease: 'easeInOut' }}
                                            >
                                                <LoginForm onSwitchToRegister={() => setIsLogin(false)} />
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                key="register"
                                                initial={{ x: 20, opacity: 0 }}
                                                animate={{ x: 0, opacity: 1 }}
                                                exit={{ x: -20, opacity: 0 }}
                                                transition={{ duration: 0.25, ease: 'easeInOut' }}
                                            >
                                                <RegisterForm onSwitchToLogin={() => setIsLogin(true)} />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* Footer Links - Mobile */}
                    <div className="lg:hidden mt-8 text-center text-sm text-slate-500">
                        <Link href="/" className="hover:text-slate-300 transition-colors">
                            Back to Home
                        </Link>
                        <span className="mx-2">•</span>
                        <Link href="/how-to-play" className="hover:text-slate-300 transition-colors">
                            How to Play
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Loading fallback
function AuthPageLoading() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 flex items-center justify-center">
            <div className="text-center">
                <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-slate-400">Loading...</p>
            </div>
        </div>
    );
}

export default function AuthPage() {
    return (
        <Suspense fallback={<AuthPageLoading />}>
            <AuthPageContent />
        </Suspense>
    );
}
