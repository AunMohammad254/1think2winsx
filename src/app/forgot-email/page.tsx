'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { lookupEmailByPhone } from './actions';
import { Phone, ArrowLeft, Loader2, CheckCircle2, AlertCircle, Mail, Search } from 'lucide-react';

const phoneSchema = z.object({
    phone: z.string()
        .regex(/^(03\d{9}|\+92\d{10})$/, 'Please enter a valid phone number (e.g., 03123456789 or +923123456789)'),
});

type ForgotEmailFormData = z.infer<typeof phoneSchema>;

export default function ForgotEmailPage() {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [maskedEmail, setMaskedEmail] = useState<string>('');

    const {
        register,
        handleSubmit,
        formState: { errors },
        reset,
    } = useForm<ForgotEmailFormData>({
        resolver: zodResolver(phoneSchema),
    });

    const onSubmit = async (data: ForgotEmailFormData) => {
        setIsSubmitting(true);
        setError(null);
        setSuccess(false);

        try {
            const formData = new FormData();
            formData.append('phone', data.phone);

            const result = await lookupEmailByPhone(formData);

            if (result.error) {
                setError(result.error);
            } else if (result.success && result.maskedEmail) {
                setSuccess(true);
                setMaskedEmail(result.maskedEmail);
            }
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        setSuccess(false);
        setError(null);
        setMaskedEmail('');
        reset();
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
                                <Search className="w-8 h-8 text-white" />
                            </div>
                        </div>
                        <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 bg-clip-text text-transparent mb-4">
                            Forgot Your Email?
                        </h2>
                        <p className="text-slate-300">
                            Enter your registered phone number to find your account.
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
                                <h3 className="text-xl font-semibold text-white mb-2">Account Found!</h3>
                                <p className="text-slate-300 mb-4">
                                    Your email address is:
                                </p>
                                <div className="bg-white/10 border border-white/20 rounded-xl p-4 mb-6">
                                    <div className="flex items-center justify-center space-x-3">
                                        <Mail className="w-6 h-6 text-purple-400" />
                                        <span className="text-xl font-mono text-white">{maskedEmail}</span>
                                    </div>
                                </div>
                                <p className="text-slate-400 text-sm mb-6">
                                    For security, we&apos;ve masked part of your email address.
                                </p>
                                <div className="space-y-3">
                                    <Link
                                        href="/login"
                                        className="block w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl font-medium hover:from-purple-700 hover:to-blue-700 transition-all text-center"
                                    >
                                        Go to Login
                                    </Link>
                                    <button
                                        onClick={handleReset}
                                        className="block w-full py-3 px-4 border border-white/20 text-white rounded-xl font-medium hover:bg-white/10 transition-all text-center"
                                    >
                                        Search Another Number
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {error && (
                                    <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-100 px-4 py-3 rounded-xl">
                                        <div className="flex items-center">
                                            <AlertCircle className="w-5 h-5 mr-3 text-red-300 flex-shrink-0" />
                                            <span className="text-sm">{error}</span>
                                        </div>
                                    </div>
                                )}

                                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                                    <div>
                                        <label htmlFor="phone" className="block text-sm font-semibold text-slate-200 mb-2">
                                            Phone Number
                                        </label>
                                        <div className="relative">
                                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                            <input
                                                id="phone"
                                                type="tel"
                                                autoComplete="tel"
                                                {...register('phone')}
                                                className="w-full pl-12 pr-4 py-3 bg-white/5 md:bg-white/10 border border-white/10 md:border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
                                                placeholder="03123456789 or +923123456789"
                                            />
                                        </div>
                                        {errors.phone && (
                                            <p className="mt-2 text-sm text-red-300 flex items-center">
                                                <AlertCircle className="w-4 h-4 mr-1" />
                                                {errors.phone.message}
                                            </p>
                                        )}
                                        <p className="mt-2 text-xs text-slate-400">
                                            Enter the phone number you used when creating your account.
                                        </p>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="w-full flex justify-center items-center py-3 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                                Searching...
                                            </>
                                        ) : (
                                            <>
                                                <Search className="w-5 h-5 mr-2" />
                                                Find My Email
                                            </>
                                        )}
                                    </button>
                                </form>

                                <div className="mt-6 pt-6 border-t border-white/10">
                                    <div className="text-center space-y-3">
                                        <Link
                                            href="/login"
                                            className="inline-flex items-center text-slate-400 hover:text-white transition-colors"
                                        >
                                            <ArrowLeft className="w-4 h-4 mr-2" />
                                            Back to login
                                        </Link>
                                        <p className="text-slate-500 text-xs">
                                            Still having trouble? Contact support for help.
                                        </p>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
