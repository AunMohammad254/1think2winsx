'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
    X,
    Lock,
    Eye,
    EyeOff,
    Loader2,
    KeyRound,
    Check,
    AlertCircle
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { isOAuthOnlyUser, getUserAuthMethods, getProviderDisplayName, type AuthMethods } from '@/lib/auth-helpers';

// Zod validation schema with strict password requirements
const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[a-z]/, 'Must contain at least one lowercase letter')
        .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
        .regex(/\d/, 'Must contain at least one number')
        .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
    confirmNewPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords don't match",
    path: ['confirmNewPassword'],
});

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

interface ChangePasswordModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// Password requirements for checklist
const passwordRequirements = [
    { id: 'length', label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
    { id: 'lowercase', label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
    { id: 'uppercase', label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
    { id: 'number', label: 'One number', test: (p: string) => /\d/.test(p) },
    { id: 'special', label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
    const { user } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCheckingAuth, setIsCheckingAuth] = useState(true);
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [authMethods, setAuthMethods] = useState<AuthMethods | null>(null);
    const [isOAuthOnly, setIsOAuthOnly] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors },
        watch,
        reset,
    } = useForm<ChangePasswordFormData>({
        resolver: zodResolver(changePasswordSchema),
        defaultValues: {
            currentPassword: '',
            newPassword: '',
            confirmNewPassword: '',
        },
    });

    const newPassword = watch('newPassword') || '';

    // Calculate password strength (0-5)
    const passwordStrength = passwordRequirements.filter(req => req.test(newPassword)).length;

    // Strength colors and labels
    const getStrengthColor = (strength: number) => {
        if (strength <= 1) return 'from-red-500 to-red-400';
        if (strength === 2) return 'from-orange-500 to-orange-400';
        if (strength === 3) return 'from-yellow-500 to-yellow-400';
        if (strength === 4) return 'from-blue-500 to-blue-400';
        return 'from-green-500 to-green-400';
    };

    const getStrengthLabel = (strength: number) => {
        if (strength <= 1) return 'Very Weak';
        if (strength === 2) return 'Weak';
        if (strength === 3) return 'Fair';
        if (strength === 4) return 'Good';
        return 'Strong';
    };

    // Check if user can change password - fetch from server (checks actual DB password field)
    useEffect(() => {
        const checkPasswordStatus = async () => {
            if (user && isOpen) {
                setIsCheckingAuth(true);
                try {
                    // Use the API endpoint that checks the actual password field in the DB
                    const response = await fetch('/api/profile/can-change-password', {
                        credentials: 'include'
                    });

                    if (response.ok) {
                        const data = await response.json();
                        setIsOAuthOnly(!data.canChangePassword);
                        setAuthMethods({
                            hasEmailPassword: data.hasPassword,
                            hasOAuth: !data.hasPassword,
                            oAuthProviders: data.authMethod === 'oauth' ? ['OAuth Provider'] : [],
                            canChangePassword: data.canChangePassword,
                            primaryAuthMethod: data.authMethod === 'email' ? 'email' : 'oauth'
                        });
                    } else {
                        // Fallback to client-side check if API fails
                        const { checkAuthMethodsClient } = await import('@/lib/auth-helpers');
                        const methods = await checkAuthMethodsClient();
                        setAuthMethods(methods);
                        setIsOAuthOnly(!methods.canChangePassword);
                    }
                } catch (error) {
                    console.error('Error checking auth methods:', error);
                    // Fallback to basic check
                    const methods = getUserAuthMethods(user);
                    setAuthMethods(methods);
                    setIsOAuthOnly(isOAuthOnlyUser(user));
                } finally {
                    setIsCheckingAuth(false);
                }
            }
        };
        checkPasswordStatus();
    }, [user, isOpen]);

    // Reset form when modal closes
    useEffect(() => {
        if (!isOpen) {
            reset();
            setShowCurrentPassword(false);
            setShowNewPassword(false);
            setShowConfirmPassword(false);
        }
    }, [isOpen, reset]);

    // Handle ESC key to close modal
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

    const onSubmit = async (data: ChangePasswordFormData) => {
        setIsSubmitting(true);

        try {
            // Get CSRF token
            const csrfResponse = await fetch('/api/csrf-token', {
                credentials: 'include'
            });
            if (!csrfResponse.ok) {
                throw new Error('Failed to get CSRF token');
            }
            const csrfData = await csrfResponse.json();

            const response = await fetch('/api/profile/change-password', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfData.csrfToken,
                },
                credentials: 'include',
                body: JSON.stringify({
                    currentPassword: data.currentPassword,
                    newPassword: data.newPassword
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Failed to change password');
            }

            toast.success('Password changed successfully!', {
                description: 'Your password has been updated.',
                duration: 4000,
            });

            reset();
            onClose();

        } catch (error) {
            const message = error instanceof Error ? error.message : 'An unexpected error occurred';
            toast.error('Failed to change password', {
                description: message,
                duration: 5000,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
                {/* Glassmorphism Card */}
                <div className="relative backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl overflow-hidden">
                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-pink-500/5 to-blue-500/10 pointer-events-none" />

                    {/* Content */}
                    <div className="relative z-10 p-6">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                                    <KeyRound className="w-5 h-5 text-white" />
                                </div>
                                <h2 className="text-xl font-bold text-white">Change Password</h2>
                            </div>
                            <button
                                onClick={onClose}
                                className="w-8 h-8 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center transition-all duration-200 group"
                            >
                                <X className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
                            </button>
                        </div>

                        {/* Loading State */}
                        {isCheckingAuth && (
                            <div className="text-center py-8">
                                <Loader2 className="w-8 h-8 text-purple-400 animate-spin mx-auto mb-3" />
                                <p className="text-slate-400 text-sm">Checking account status...</p>
                            </div>
                        )}

                        {/* OAuth User Warning */}
                        {!isCheckingAuth && isOAuthOnly && authMethods && (
                            <div className="text-center py-8">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r from-amber-500/20 to-orange-500/20 flex items-center justify-center border border-amber-500/30">
                                    <AlertCircle className="w-8 h-8 text-amber-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-white mb-2">Password Change Not Available</h3>
                                <p className="text-slate-300 text-sm mb-4">
                                    Your account was created using{' '}
                                    <span className="font-semibold text-purple-400">
                                        {authMethods.oAuthProviders.map(getProviderDisplayName).join(' and ')}
                                    </span>
                                    {' '}sign-in.
                                </p>
                                <p className="text-slate-400 text-xs">
                                    Please manage your password through your OAuth provider.
                                </p>
                            </div>
                        )}

                        {/* Password Change Form */}
                        {!isCheckingAuth && !isOAuthOnly && (
                            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                                {/* Current Password */}
                                <div className="space-y-2">
                                    <label htmlFor="currentPassword" className="block text-sm font-medium text-slate-200">
                                        Current Password
                                    </label>
                                    <div className="relative group">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-purple-400 transition-colors" />
                                        <input
                                            id="currentPassword"
                                            type={showCurrentPassword ? 'text' : 'password'}
                                            {...register('currentPassword')}
                                            className="w-full pl-11 pr-11 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 hover:bg-white/[0.07]"
                                            placeholder="Enter current password"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-purple-400 transition-colors"
                                        >
                                            {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                    {errors.currentPassword && (
                                        <p className="text-xs text-red-400 flex items-center gap-1 mt-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {errors.currentPassword.message}
                                        </p>
                                    )}
                                </div>

                                {/* New Password */}
                                <div className="space-y-2">
                                    <label htmlFor="newPassword" className="block text-sm font-medium text-slate-200">
                                        New Password
                                    </label>
                                    <div className="relative group">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-purple-400 transition-colors" />
                                        <input
                                            id="newPassword"
                                            type={showNewPassword ? 'text' : 'password'}
                                            {...register('newPassword')}
                                            className="w-full pl-11 pr-11 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 hover:bg-white/[0.07]"
                                            placeholder="Enter new password"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowNewPassword(!showNewPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-purple-400 transition-colors"
                                        >
                                            {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                    {errors.newPassword && (
                                        <p className="text-xs text-red-400 flex items-center gap-1 mt-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {errors.newPassword.message}
                                        </p>
                                    )}

                                    {/* Password Strength Meter */}
                                    {newPassword && (
                                        <div className="mt-3 space-y-3">
                                            {/* Progress Bar */}
                                            <div className="flex items-center gap-3">
                                                <div className="flex-1 h-2 bg-slate-700/50 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full bg-gradient-to-r ${getStrengthColor(passwordStrength)} transition-all duration-500 ease-out`}
                                                        style={{ width: `${(passwordStrength / 5) * 100}%` }}
                                                    />
                                                </div>
                                                <span className={`text-xs font-medium min-w-16 text-right ${passwordStrength <= 2 ? 'text-red-400' :
                                                    passwordStrength <= 3 ? 'text-yellow-400' :
                                                        'text-green-400'
                                                    }`}>
                                                    {getStrengthLabel(passwordStrength)}
                                                </span>
                                            </div>

                                            {/* Requirements Checklist */}
                                            <div className="grid grid-cols-2 gap-1.5">
                                                {passwordRequirements.map((req) => {
                                                    const isPassing = req.test(newPassword);
                                                    return (
                                                        <div
                                                            key={req.id}
                                                            className={`flex items-center gap-1.5 text-xs transition-colors duration-200 ${isPassing ? 'text-green-400' : 'text-slate-500'
                                                                }`}
                                                        >
                                                            <Check className={`w-3 h-3 ${isPassing ? 'opacity-100' : 'opacity-30'}`} />
                                                            <span>{req.label}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Confirm New Password */}
                                <div className="space-y-2">
                                    <label htmlFor="confirmNewPassword" className="block text-sm font-medium text-slate-200">
                                        Confirm New Password
                                    </label>
                                    <div className="relative group">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-purple-400 transition-colors" />
                                        <input
                                            id="confirmNewPassword"
                                            type={showConfirmPassword ? 'text' : 'password'}
                                            {...register('confirmNewPassword')}
                                            className="w-full pl-11 pr-11 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 hover:bg-white/[0.07]"
                                            placeholder="Confirm new password"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-purple-400 transition-colors"
                                        >
                                            {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                    {errors.confirmNewPassword && (
                                        <p className="text-xs text-red-400 flex items-center gap-1 mt-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {errors.confirmNewPassword.message}
                                        </p>
                                    )}
                                </div>

                                {/* Action Buttons */}
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-slate-300 font-medium hover:bg-white/10 transition-all duration-200"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl text-white font-semibold hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Changing...
                                            </>
                                        ) : (
                                            <>
                                                <KeyRound className="w-4 h-4" />
                                                Change Password
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
