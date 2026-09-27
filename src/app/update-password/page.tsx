'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { updatePassword } from './actions';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, KeyRound, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const updatePasswordSchema = z.object({
    password: z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])/, 'Password must contain uppercase, lowercase, number, and special character'),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
});

type UpdatePasswordFormData = z.infer<typeof updatePasswordSchema>;

export default function UpdatePasswordPage() {
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isValidSession, setIsValidSession] = useState<boolean | null>(null);
    const supabase = createClient();

    const {
        register,
        handleSubmit,
        formState: { errors },
        watch,
    } = useForm<UpdatePasswordFormData>({
        resolver: zodResolver(updatePasswordSchema),
    });

    const password = watch('password');

    // Check if user has a valid session (came from password reset link)
    useEffect(() => {
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setIsValidSession(!!session);
        };
        checkSession();
    }, [supabase.auth]);

    const passwordStrength = password ? Math.min(5, [
        password.length >= 8,
        /[a-z]/.test(password),
        /[A-Z]/.test(password),
        /\d/.test(password),
        /[^\w\s]/.test(password)
    ].filter(Boolean).length) : 0;

    const strengthColors = ['bg-red-500', 'bg-red-400', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500'];
    const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];

    const onSubmit = async (data: UpdatePasswordFormData) => {
        setIsSubmitting(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('password', data.password);
            formData.append('confirmPassword', data.confirmPassword);

            const result = await updatePassword(formData);

            if (result.error) {
                setError(result.error);
            } else {
                setSuccess(true);
                setTimeout(() => {
                    router.push('/login?password_reset=success');
                }, 2000);
            }
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Loading state while checking session
    if (isValidSession === null) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            </div>
        );
    }

    // Invalid session - user didn't come from password reset link
    if (!isValidSession) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-md text-center">
                    <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-white mb-2">Invalid or Expired Link</h2>
                    <p className="text-slate-300 mb-6">
                        This password reset link is invalid or has expired. Please request a new one.
                    </p>
                    <Link
                        href="/forgot-password"
                        className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl font-medium hover:from-purple-700 hover:to-blue-700 transition-all"
                    >
                        Request New Link
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen relative overflow-hidden">
            {/* Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-blue-500/5 to-pink-500/5 hidden md:block"></div>
            </div>

            <div className="relative z-10 min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="text-center mb-8">
                        <div className="flex justify-center mb-6">
                            <div className="p-4 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full">
                                <KeyRound className="w-8 h-8 text-white" />
                            </div>
                        </div>
                        <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 bg-clip-text text-transparent mb-4">
                            Set New Password
                        </h2>
                        <p className="text-slate-300">
                            Enter your new password below.
                        </p>
                    </div>
                </div>

                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white/5 md:backdrop-blur-xl md:bg-white/10 border border-white/10 md:border-white/20 rounded-2xl shadow-2xl p-8">
                        {success ? (
                            <div className="text-center">
                                <div className="mb-6 flex justify-center">
                                    <div className="p-4 bg-green-500/20 rounded-full">
                                        <CheckCircle2 className="w-12 h-12 text-green-400" />
                                    </div>
                                </div>
                                <h3 className="text-xl font-semibold text-white mb-2">Password Updated!</h3>
                                <p className="text-slate-300 mb-4">Redirecting to login...</p>
                                <Loader2 className="w-6 h-6 text-purple-400 animate-spin mx-auto" />
                            </div>
                        ) : (
                            <>
                                {error && (
                                    <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-100 px-4 py-3 rounded-xl">
                                        <div className="flex items-center">
                                            <AlertCircle className="w-5 h-5 mr-3 text-red-300" />
                                            <span>{error}</span>
                                        </div>
                                    </div>
                                )}

                                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                                    {/* New Password */}
                                    <div>
                                        <label htmlFor="password" className="block text-sm font-semibold text-slate-200 mb-2">
                                            New Password
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                            <input
                                                id="password"
                                                type={showPassword ? 'text' : 'password'}
                                                {...register('password')}
                                                className="w-full pl-12 pr-12 py-3 bg-white/5 md:bg-white/10 border border-white/10 md:border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                                placeholder="Enter new password"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                                            >
                                                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                            </button>
                                        </div>
                                        {password && (
                                            <div className="mt-3">
                                                <div className="flex items-center space-x-3">
                                                    <div className="flex-1 bg-slate-700/50 rounded-full h-2 overflow-hidden">
                                                        <div
                                                            className={`h-2 rounded-full transition-all duration-500 ${strengthColors[passwordStrength - 1] || 'bg-slate-600'}`}
                                                            style={{ width: `${(passwordStrength / 5) * 100}%` }}
                                                        ></div>
                                                    </div>
                                                    <span className="text-xs text-slate-300 font-medium min-w-fit">
                                                        {strengthLabels[passwordStrength - 1] || 'Very Weak'}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        {errors.password && (
                                            <p className="mt-2 text-sm text-red-300 flex items-center">
                                                <AlertCircle className="w-4 h-4 mr-1" />
                                                {errors.password.message}
                                            </p>
                                        )}
                                    </div>

                                    {/* Confirm Password */}
                                    <div>
                                        <label htmlFor="confirmPassword" className="block text-sm font-semibold text-slate-200 mb-2">
                                            Confirm Password
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                            <input
                                                id="confirmPassword"
                                                type={showConfirmPassword ? 'text' : 'password'}
                                                {...register('confirmPassword')}
                                                className="w-full pl-12 pr-12 py-3 bg-white/5 md:bg-white/10 border border-white/10 md:border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                                placeholder="Confirm new password"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                                            >
                                                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                            </button>
                                        </div>
                                        {errors.confirmPassword && (
                                            <p className="mt-2 text-sm text-red-300 flex items-center">
                                                <AlertCircle className="w-4 h-4 mr-1" />
                                                {errors.confirmPassword.message}
                                            </p>
                                        )}
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="w-full flex justify-center items-center py-3 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                                Updating...
                                            </>
                                        ) : (
                                            'Update Password'
                                        )}
                                    </button>
                                </form>

                                <div className="mt-6 text-center">
                                    <Link
                                        href="/login"
                                        className="inline-flex items-center text-slate-400 hover:text-white transition-colors"
                                    >
                                        <ArrowLeft className="w-4 h-4 mr-2" />
                                        Back to login
                                    </Link>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
