'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { resetPassword } from './actions';
import { Mail, ArrowLeft, Loader2, CheckCircle2, AlertCircle, KeyRound } from 'lucide-react';

const forgotPasswordSchema = z.object({
    email: z.string().email('Please enter a valid email address'),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string>('');

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<ForgotPasswordFormData>({
        resolver: zodResolver(forgotPasswordSchema),
    });

    const onSubmit = async (data: ForgotPasswordFormData) => {
        setIsSubmitting(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('email', data.email);

            const result = await resetPassword(formData);

            if (result.error) {
                setError(result.error);
            } else {
                setSuccess(true);
                setMessage(result.message || 'Password reset link sent!');
            }
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen relative overflow-hidden">
            {/* Background */}
            <div
                className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.02'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            >
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-blue-500/5 to-pink-500/5 hidden md:block md:animate-pulse"></div>
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl hidden md:block"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl hidden md:block"></div>
            </div>

            <div className="relative z-10 min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <div className="flex justify-center mb-6">
                            <div className="p-4 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full">
                                <KeyRound className="w-8 h-8 text-white" />
                            </div>
                        </div>
                        <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 bg-clip-text text-transparent mb-4">
                            Forgot Password?
                        </h2>
                        <p className="text-slate-300">
                            No worries! Enter your email and we&apos;ll send you a reset link.
                        </p>
                    </div>
                </div>

                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white/5 md:backdrop-blur-xl md:bg-white/10 border border-white/10 md:border-white/20 rounded-2xl shadow-lg md:shadow-2xl p-8">
                        {success ? (
                            <div className="text-center">
                                <div className="mb-6 flex justify-center">
                                    <div className="p-4 bg-green-500/20 rounded-full">
                                        <CheckCircle2 className="w-12 h-12 text-green-400" />
                                    </div>
                                </div>
                                <h3 className="text-xl font-semibold text-white mb-2">Check your email</h3>
                                <p className="text-slate-300 mb-6">{message}</p>
                                <Link
                                    href="/login"
                                    className="inline-flex items-center text-purple-400 hover:text-purple-300 transition-colors"
                                >
                                    <ArrowLeft className="w-4 h-4 mr-2" />
                                    Back to login
                                </Link>
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
                                    <div>
                                        <label htmlFor="email" className="block text-sm font-semibold text-slate-200 mb-2">
                                            Email Address
                                        </label>
                                        <div className="relative">
                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                            <input
                                                id="email"
                                                type="email"
                                                autoComplete="email"
                                                {...register('email')}
                                                className="w-full pl-12 pr-4 py-3 bg-white/5 md:bg-white/10 border border-white/10 md:border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
                                                placeholder="Enter your email address"
                                            />
                                        </div>
                                        {errors.email && (
                                            <p className="mt-2 text-sm text-red-300 flex items-center">
                                                <AlertCircle className="w-4 h-4 mr-1" />
                                                {errors.email.message}
                                            </p>
                                        )}
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="w-full flex justify-center items-center py-3 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                                Sending...
                                            </>
                                        ) : (
                                            'Send Reset Link'
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
