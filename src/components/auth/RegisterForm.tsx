'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import {
    User,
    Mail,
    Lock,
    Eye,
    EyeOff,
    Phone,
    Calendar,
    AlertCircle,
    CheckCircle2,
    Loader2,
    ArrowRight,
} from 'lucide-react';
import { registerAction, getGoogleOAuthUrl } from '@/actions/auth-actions';
import DatePicker from '@/components/ui/DatePicker';

const registerSchema = z
    .object({
        name: z
            .string()
            .min(2, 'Name must be at least 2 characters')
            .max(50, 'Name must be less than 50 characters')
            .regex(/^[a-zA-Z\s]+$/, 'Name can only contain letters and spaces'),
        email: z.string().email('Please enter a valid email address').toLowerCase(),
        password: z
            .string()
            .min(8, 'Password must be at least 8 characters')
            .regex(
                /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])/,
                'Password must contain uppercase, lowercase, number, and special character'
            ),
        confirmPassword: z.string(),
        phone: z
            .string()
            .regex(
                /^(03\d{9}|\+92\d{10})$/,
                'Please enter a valid phone number (e.g., 03123456789)'
            )
            .optional()
            .or(z.literal('')),
        dateOfBirth: z.string().refine((date) => {
            if (!date) return true;
            const birthDate = new Date(date);
            const today = new Date();
            const age = today.getFullYear() - birthDate.getFullYear();
            return age >= 13 && age <= 100;
        }, 'You must be between 13 and 100 years old'),
        agreeToTerms: z
            .boolean()
            .refine((val) => val === true, 'You must agree to the terms'),
    })
    .refine((data) => data.password === data.confirmPassword, {
        message: "Passwords don't match",
        path: ['confirmPassword'],
    });

type RegisterFormData = z.infer<typeof registerSchema>;

interface RegisterFormProps {
    onSwitchToLogin: () => void;
}

export default function RegisterForm({ onSwitchToLogin }: RegisterFormProps) {
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        formState: { errors },
        watch,
        setValue,
    } = useForm<RegisterFormData>({
        resolver: zodResolver(registerSchema),
    });

    const password = watch('password');

    // Password strength calculation
    const strengthColors = [
        'bg-red-500',
        'bg-orange-500',
        'bg-yellow-500',
        'bg-blue-500',
        'bg-green-500',
    ];
    const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];

    const passwordStrength = password
        ? Math.min(
            5,
            [
                password.length >= 8,
                /[a-z]/.test(password),
                /[A-Z]/.test(password),
                /\d/.test(password),
                /[^\w\s]/.test(password),
            ].filter(Boolean).length
        )
        : 0;

    const onSubmit = async (data: RegisterFormData) => {
        setIsSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await registerAction({
                name: data.name,
                email: data.email,
                password: data.password,
                phone: data.phone || undefined,
                dateOfBirth: data.dateOfBirth || undefined,
            });

            if (!result.success) {
                setError(result.error || 'Registration failed');
            } else {
                setSuccess('Account created! Please check your email to verify your account.');
                setTimeout(() => {
                    onSwitchToLogin();
                }, 2000);
            }
        } catch {
            setError('An error occurred during registration');
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
            <div className="text-center mb-6">
                <h2 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 bg-clip-text text-transparent mb-3">
                    Create Account
                </h2>
                <p className="text-slate-400">Join us and start playing quizzes</p>
            </div>

            {/* Messages */}
            {error && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mb-4 bg-red-500/10 backdrop-blur-xl border border-red-500/30 text-red-100 px-4 py-3 rounded-xl"
                >
                    <div className="flex items-center">
                        <AlertCircle className="w-5 h-5 mr-3 text-red-300 flex-shrink-0" />
                        <span className="text-sm">{error}</span>
                    </div>
                </motion.div>
            )}

            {success && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mb-4 bg-green-500/10 backdrop-blur-xl border border-green-500/30 text-green-100 px-4 py-3 rounded-xl"
                >
                    <div className="flex items-center">
                        <CheckCircle2 className="w-5 h-5 mr-3 text-green-300 flex-shrink-0" />
                        <span className="text-sm">{success}</span>
                    </div>
                </motion.div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
                {/* Name Field */}
                <FormField
                    id="register-name"
                    label="Full Name"
                    icon={<User className="w-5 h-5" />}
                    error={errors.name?.message}
                >
                    <input
                        id="register-name"
                        type="text"
                        autoComplete="name"
                        suppressHydrationWarning
                        {...register('name')}
                        className="w-full pl-12 pr-4 py-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                        placeholder="Enter your full name"
                    />
                </FormField>

                {/* Email Field */}
                <FormField
                    id="register-email"
                    label="Email Address"
                    icon={<Mail className="w-5 h-5" />}
                    error={errors.email?.message}
                >
                    <input
                        id="register-email"
                        type="email"
                        autoComplete="email"
                        suppressHydrationWarning
                        {...register('email')}
                        className="w-full pl-12 pr-4 py-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                        placeholder="Enter your email"
                    />
                </FormField>

                {/* Phone Field */}
                <FormField
                    id="register-phone"
                    label="Phone (Optional)"
                    icon={<Phone className="w-5 h-5" />}
                    error={errors.phone?.message}
                >
                    <input
                        id="register-phone"
                        type="tel"
                        autoComplete="tel"
                        suppressHydrationWarning
                        {...register('phone')}
                        className="w-full pl-12 pr-4 py-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                        placeholder="03123456789"
                    />
                </FormField>

                {/* Date of Birth Field */}
                <div>
                    <label htmlFor="register-dob" className="block text-sm font-medium text-slate-300 mb-2">
                        Date of Birth
                    </label>
                    <DatePicker
                        id="register-dob"
                        value={watch('dateOfBirth') || ''}
                        onChange={(date) => setValue('dateOfBirth', date, { shouldValidate: true })}
                        placeholder="Select your date of birth"
                        minYear={1924}
                        maxYear={new Date().getFullYear() - 13}
                    />
                    {errors.dateOfBirth && (
                        <p className="mt-1 text-sm text-red-400 flex items-center">
                            <AlertCircle className="w-4 h-4 mr-1" />
                            {errors.dateOfBirth.message}
                        </p>
                    )}
                </div>

                {/* Password Field */}
                <div>
                    <PasswordField
                        id="register-password"
                        label="Password"
                        register={register('password')}
                        error={errors.password?.message}
                        placeholder="Create a strong password"
                    />
                    {/* Password Strength Indicator */}
                    {password && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="mt-3 space-y-2"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex-1 bg-slate-700/50 rounded-full h-2 overflow-hidden">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${(passwordStrength / 5) * 100}%` }}
                                        className={`h-2 rounded-full transition-all duration-300 ${strengthColors[passwordStrength - 1] || 'bg-slate-600'
                                            }`}
                                    />
                                </div>
                                <span className="text-xs text-slate-400 min-w-[70px]">
                                    {strengthLabels[passwordStrength - 1] || 'Very Weak'}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-1 text-xs">
                                <PasswordCheck check={password.length >= 8} label="8+ characters" />
                                <PasswordCheck check={/[a-z]/.test(password)} label="Lowercase" />
                                <PasswordCheck check={/[A-Z]/.test(password)} label="Uppercase" />
                                <PasswordCheck check={/\d/.test(password)} label="Number" />
                                <PasswordCheck check={/[^\w\s]/.test(password)} label="Special char" />
                            </div>
                        </motion.div>
                    )}
                </div>

                {/* Confirm Password Field */}
                <PasswordField
                    id="register-confirm-password"
                    label="Confirm Password"
                    register={register('confirmPassword')}
                    error={errors.confirmPassword?.message}
                    placeholder="Confirm your password"
                />

                {/* Terms Checkbox */}
                <div className="flex items-start gap-3">
                    <input
                        id="agreeToTerms"
                        type="checkbox"
                        {...register('agreeToTerms')}
                        className="mt-1 h-4 w-4 rounded border-white/20 bg-white/10 text-purple-600 focus:ring-purple-500/50"
                    />
                    <label htmlFor="agreeToTerms" className="text-sm text-slate-400">
                        I agree to the{' '}
                        <Link href="/terms" className="text-purple-400 hover:text-purple-300 underline">
                            Terms
                        </Link>{' '}
                        and{' '}
                        <Link href="/privacy" className="text-purple-400 hover:text-purple-300 underline">
                            Privacy Policy
                        </Link>
                    </label>
                </div>
                {errors.agreeToTerms && (
                    <p className="text-sm text-red-400 flex items-center">
                        <AlertCircle className="w-4 h-4 mr-1" />
                        {errors.agreeToTerms.message}
                    </p>
                )}

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
                            Creating Account...
                        </>
                    ) : (
                        <>
                            Create Account
                            <ArrowRight className="w-5 h-5" />
                        </>
                    )}
                </motion.button>
            </form>

            {/* Divider */}
            <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-sm">
                    <span className="px-3 bg-slate-900/80 text-slate-500">Or</span>
                </div>
            </div>

            {/* Google Sign-in Button */}
            <motion.button
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading || isSubmitting}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3 px-4 bg-white/5 backdrop-blur-xl border border-white/10 hover:bg-white/10 text-white font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-3 disabled:opacity-50"
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

            {/* Switch to Login */}
            <p className="mt-6 text-center text-slate-400">
                Already have an account?{' '}
                <button
                    type="button"
                    onClick={onSwitchToLogin}
                    className="font-semibold text-purple-400 hover:text-purple-300 transition-colors"
                >
                    Sign in
                </button>
            </p>
        </motion.div>
    );
}

// Reusable Form Field Component
function FormField({
    id,
    label,
    icon,
    error,
    children,
}: {
    id: string;
    label: string;
    icon: React.ReactNode;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-2">
                {label}
            </label>
            <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">{icon}</div>
                {children}
            </div>
            {error && (
                <p className="mt-1 text-sm text-red-400 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-1" />
                    {error}
                </p>
            )}
        </div>
    );
}

// Password Field with Toggle
function PasswordField({
    id,
    label,
    register,
    error,
    placeholder,
}: {
    id: string;
    label: string;
    register: React.InputHTMLAttributes<HTMLInputElement>;
    error?: string;
    placeholder: string;
}) {
    const [showPassword, setShowPassword] = useState(false);

    return (
        <div>
            <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-2">
                {label}
            </label>
            <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                    id={id}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    suppressHydrationWarning
                    {...register}
                    className="w-full pl-12 pr-12 py-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                    placeholder={placeholder}
                />
                <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
            </div>
            {error && (
                <p className="mt-1 text-sm text-red-400 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-1" />
                    {error}
                </p>
            )}
        </div>
    );
}

// Password Requirement Check Component
function PasswordCheck({ check, label }: { check: boolean; label: string }) {
    return (
        <div className={`flex items-center gap-1 ${check ? 'text-green-400' : 'text-slate-500'}`}>
            <CheckCircle2 className="w-3 h-3" />
            <span>{label}</span>
        </div>
    );
}
