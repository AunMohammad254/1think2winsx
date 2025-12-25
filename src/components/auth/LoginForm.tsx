'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Loader2, LogIn } from 'lucide-react';
import { loginAction, getGoogleOAuthUrl } from '@/actions/auth-actions';

const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
    onSwitchToRegister: () => void;
}

export default function LoginForm({ onSwitchToRegister }: LoginFormProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Check for success messages from URL params
    const registered = searchParams.get('registered') === 'true';
    const passwordReset = searchParams.get('password_reset') === 'success';

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
    });

    const onSubmit = async (data: LoginFormData) => {
        setIsSubmitting(true);
        setError(null);

        try {
            const result = await loginAction(data);

            if (!result.success) {
                setError(result.error || 'Login failed');
            } else if (result.redirectTo) {
                router.push(result.redirectTo);
                router.refresh();
            }
        } catch {
            setError('An error occurred during login');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setIsGoogleLoading(true);
        setError(null);

        try {
            const url = await getGoogleOAuthUrl('/quizzes');
            if (url) {
                window.location.href = url;
            } else {
                setError('Failed to initiate Google sign-in');
                setIsGoogleLoading(false);
            }
        } catch {
            setError('An error occurred during Google sign-in');
            setIsGoogleLoading(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="w-full"
        >
            {/* Header */}
            <div className="text-center mb-8">
                <h2 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 bg-clip-text text-transparent mb-3">
                    Welcome Back
                </h2>
                <p className="text-slate-400">
                    Sign in to continue your quiz journey
                </p>
            </div>

            {/* Success Messages */}
            {(registered || passwordReset) && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mb-6 bg-green-500/10 backdrop-blur-xl border border-green-500/30 text-green-100 px-4 py-3 rounded-xl"
                >
                    <div className="flex items-center">
                        <LogIn className="w-5 h-5 mr-3 text-green-300" />
                        <span>
                            {registered
                                ? 'Registration successful! Please check your email to verify your account.'
                                : 'Password updated successfully! Please log in with your new password.'}
                        </span>
                    </div>
                </motion.div>
            )}

            {/* Error Message */}
            {error && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mb-6 bg-red-500/10 backdrop-blur-xl border border-red-500/30 text-red-100 px-4 py-3 rounded-xl"
                >
                    <div className="flex items-center">
                        <AlertCircle className="w-5 h-5 mr-3 text-red-300 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                </motion.div>
            )}

            <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
                {/* Email Field */}
                <div>
                    <label htmlFor="login-email" className="block text-sm font-medium text-slate-300 mb-2">
                        Email Address
                    </label>
                    <div className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-300 hidden md:block" />
                        <div className="relative flex items-center">
                            <Mail className="absolute left-4 w-5 h-5 text-slate-400" />
                            <input
                                id="login-email"
                                type="email"
                                autoComplete="email"
                                suppressHydrationWarning
                                {...register('email')}
                                className="w-full pl-12 pr-4 py-3.5 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
                                placeholder="Enter your email"
                            />
                        </div>
                    </div>
                    {errors.email && (
                        <p className="mt-2 text-sm text-red-400 flex items-center">
                            <AlertCircle className="w-4 h-4 mr-1" />
                            {errors.email.message}
                        </p>
                    )}
                </div>

                {/* Password Field */}
                <div>
                    <label htmlFor="login-password" className="block text-sm font-medium text-slate-300 mb-2">
                        Password
                    </label>
                    <div className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-300 hidden md:block" />
                        <PasswordInput
                            id="login-password"
                            register={register('password')}
                            placeholder="Enter your password"
                        />
                    </div>
                    {errors.password && (
                        <p className="mt-2 text-sm text-red-400 flex items-center">
                            <AlertCircle className="w-4 h-4 mr-1" />
                            {errors.password.message}
                        </p>
                    )}
                </div>

                {/* Forgot Password Link */}
                <div className="flex justify-end">
                    <Link
                        href="/forgot-password"
                        className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
                    >
                        Forgot password?
                    </Link>
                </div>

                {/* Submit Button */}
                <motion.button
                    type="submit"
                    disabled={isSubmitting}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full py-3.5 px-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Signing in...
                        </>
                    ) : (
                        <>
                            <LogIn className="w-5 h-5" />
                            Sign In
                        </>
                    )}
                </motion.button>
            </form>

            {/* Divider */}
            <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-sm">
                    <span className="px-3 bg-slate-900/80 text-slate-500">Or continue with</span>
                </div>
            </div>

            {/* Google Sign-in Button */}
            <motion.button
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading || isSubmitting}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3.5 px-4 bg-white/5 backdrop-blur-xl border border-white/10 hover:bg-white/10 text-white font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-3 disabled:opacity-50"
            >
                {isGoogleLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path
                            fill="currentColor"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                            fill="currentColor"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                            fill="currentColor"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                            fill="currentColor"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                    </svg>
                )}
                {isGoogleLoading ? 'Signing in...' : 'Continue with Google'}
            </motion.button>

            {/* Switch to Register */}
            <p className="mt-8 text-center text-slate-400">
                Don't have an account?{' '}
                <button
                    type="button"
                    onClick={onSwitchToRegister}
                    className="font-semibold text-purple-400 hover:text-purple-300 transition-colors"
                >
                    Create one now
                </button>
            </p>

            {/* Additional Helpful Links */}
            <div className="mt-6 pt-6 border-t border-white/10 space-y-3 text-center">
                <p className="text-slate-500 text-sm">Need help?</p>
                <div className="flex flex-col gap-2">
                    <Link
                        href="/how-to-play"
                        className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                        Learn how to play →
                    </Link>
                    <Link
                        href="/forgot-email"
                        className="text-sm text-slate-400 hover:text-slate-300 transition-colors"
                    >
                        Forgot your email? Recover via phone →
                    </Link>
                    <Link
                        href="/auth/clear"
                        className="text-sm text-slate-500 hover:text-slate-400 transition-colors"
                    >
                        Having login issues? Clear session →
                    </Link>
                </div>
            </div>
        </motion.div>
    );
}

// Password Input with toggle visibility
function PasswordInput({
    id,
    register,
    placeholder,
}: {
    id: string;
    register: React.InputHTMLAttributes<HTMLInputElement>;
    placeholder: string;
}) {
    const [showPassword, setShowPassword] = useState(false);

    return (
        <div className="relative flex items-center">
            <Lock className="absolute left-4 w-5 h-5 text-slate-400" />
            <input
                id={id}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                suppressHydrationWarning
                {...register}
                className="w-full pl-12 pr-12 py-3.5 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
                placeholder={placeholder}
            />
            <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 text-slate-400 hover:text-white transition-colors"
            >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
        </div>
    );
}
