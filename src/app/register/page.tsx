'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import { User, Mail, Lock, Eye, EyeOff, Phone, Calendar, AlertCircle, CheckCircle2, ArrowRight, Loader2, LogIn } from 'lucide-react';

const registerSchema = z.object({
  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must be less than 50 characters')
    .regex(/^[a-zA-Z\s]+$/, 'Name can only contain letters and spaces'),
  email: z.string()
    .email('Please enter a valid email address')
    .toLowerCase(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])/, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  confirmPassword: z.string(),
  phone: z.string()
    .regex(/^(03\d{9}|\+92\d{10})$/, 'Please enter a valid phone number (e.g., 03123456789 or +923123456789)')
    .optional()
    .or(z.literal('')),
  dateOfBirth: z.string()
    .refine((date) => {
      if (!date) return true;
      const birthDate = new Date(date);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      return age >= 13 && age <= 100;
    }, 'You must be between 13 and 100 years old'),
  agreeToTerms: z.boolean()
    .refine((val) => val === true, 'You must agree to the terms and conditions'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type RegisterFormData = z.infer<typeof registerSchema>;

export default function Register() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const password = watch('password');

  const strengthColors = ['bg-red-500', 'bg-red-400', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500', 'bg-green-600'];
  const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];

  const passwordStrength = password ? Math.min(5, [
    password.length >= 8,
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^\w\s]/.test(password)
  ].filter(Boolean).length) : 0;

  const onSubmit = async (data: RegisterFormData) => {
    setIsSubmitting(true);
    setError('');
    setSuccess('');

    try {
      // Sign up with Supabase Auth
      const { error: signUpError, data: authData } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            name: data.name,
            phone: data.phone || null,
            date_of_birth: data.dateOfBirth || null,
          },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/quizzes`,
        },
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          setError('This email is already registered. Please log in instead.');
        } else if (signUpError.message.includes('email') || signUpError.status === 500) {
          setError('Unable to send confirmation email. Please try again or contact support.');
          console.error('Supabase signup error:', signUpError);
        } else {
          setError(signUpError.message);
        }
        return;
      }

      // User is now automatically created in public.User table via database trigger
      // No need for manual sync

      setSuccess('Account created successfully! Please check your email to verify your account.');
      setTimeout(() => {
        router.push('/login?registered=true');
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during registration');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%224%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20"></div>
        {!isMobile && (
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-purple-500/10 to-blue-500/10 animate-pulse"></div>
        )}
      </div>

      <div className="relative z-10 flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <Link href="/" className="inline-block group touch-manipulation">
              <div className="relative">
                {!isMobile && (
                  <div className="absolute -inset-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full blur opacity-75 group-hover:opacity-100 transition duration-300 animate-pulse"></div>
                )}
                <div className={`relative bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-full font-bold text-xl shadow-lg ${!isMobile ? 'transform group-hover:scale-105 transition-all duration-200' : ''}`}>
                  Kheelo Or Jeeto
                </div>
              </div>
            </Link>
            <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-white">
              Create your account
            </h2>
            <p className="mt-2 text-center text-sm text-slate-400">
              Already have an account?{' '}
              <Link href="/login" className={`font-semibold text-purple-400 ${!isMobile ? 'hover:text-purple-300' : ''} transition-colors duration-200 touch-manipulation`}>
                Sign in here
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className={`${isMobile ? 'bg-slate-800/90 border border-slate-700/50' : 'backdrop-blur-xl bg-white/10 border border-white/20'} rounded-2xl shadow-2xl p-8`}>
            {/* Error Message */}
            {error && (
              <div className={`mb-6 ${isMobile ? 'bg-red-900/50 border border-red-700/50' : 'backdrop-blur-xl bg-red-500/20 border border-red-500/30'} text-red-100 px-4 py-3 rounded-xl shadow-lg`}>
                <div className="flex items-center">
                  <AlertCircle className="w-5 h-5 mr-3 text-red-300" />
                  <span className="block sm:inline">{error}</span>
                </div>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className={`mb-6 ${isMobile ? 'bg-green-900/50 border border-green-700/50' : 'backdrop-blur-xl bg-green-500/20 border border-green-500/30'} text-green-100 px-4 py-3 rounded-xl shadow-lg`}>
                <div className="flex items-center">
                  <CheckCircle2 className="w-5 h-5 mr-3 text-green-300" />
                  <span className="block sm:inline">{success}</span>
                </div>
              </div>
            )}

            <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
              {/* Name Field */}
              <div>
                <label htmlFor="name" className="block text-sm font-semibold text-slate-200 mb-2">
                  Full Name
                </label>
                <div className="relative group">
                  {!isMobile && (
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-300"></div>
                  )}
                  <div className="relative flex items-center">
                    <User className="absolute left-4 w-5 h-5 text-slate-400" />
                    <input
                      id="name"
                      type="text"
                      autoComplete="name"
                      {...register('name')}
                      className={`w-full pl-12 pr-4 py-3 ${isMobile ? 'bg-slate-700/50 border border-slate-600/50' : 'backdrop-blur-xl bg-white/10 border border-white/20'} rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 shadow-lg`}
                      placeholder="Enter your full name"
                    />
                  </div>
                </div>
                {errors.name && (
                  <p className="mt-2 text-sm text-red-300 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-1" />
                    {errors.name.message}
                  </p>
                )}
              </div>

              {/* Email Field */}
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-200 mb-2">
                  Email Address
                </label>
                <div className="relative group">
                  {!isMobile && (
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-300"></div>
                  )}
                  <div className="relative flex items-center">
                    <Mail className="absolute left-4 w-5 h-5 text-slate-400" />
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      {...register('email')}
                      className={`w-full pl-12 pr-4 py-3 ${isMobile ? 'bg-slate-700/50 border border-slate-600/50' : 'backdrop-blur-xl bg-white/10 border border-white/20'} rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 shadow-lg`}
                      placeholder="Enter your email address"
                    />
                  </div>
                </div>
                {errors.email && (
                  <p className="mt-2 text-sm text-red-300 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-1" />
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* Phone Field */}
              <div>
                <label htmlFor="phone" className="block text-sm font-semibold text-slate-200 mb-2">
                  Phone Number (Optional)
                </label>
                <div className="relative group">
                  {!isMobile && (
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-300"></div>
                  )}
                  <div className="relative flex items-center">
                    <Phone className="absolute left-4 w-5 h-5 text-slate-400" />
                    <input
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      {...register('phone')}
                      className={`w-full pl-12 pr-4 py-3 ${isMobile ? 'bg-slate-700/50 border border-slate-600/50' : 'backdrop-blur-xl bg-white/10 border border-white/20'} rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 shadow-lg`}
                      placeholder="03123456789 or +923123456789"
                    />
                  </div>
                </div>
                {errors.phone && (
                  <p className="mt-2 text-sm text-red-300 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-1" />
                    {errors.phone.message}
                  </p>
                )}
              </div>

              {/* Date of Birth Field */}
              <div>
                <label htmlFor="dateOfBirth" className="block text-sm font-semibold text-slate-200 mb-2">
                  Date of Birth
                </label>
                <div className="relative group">
                  {!isMobile && (
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-300"></div>
                  )}
                  <div className="relative flex items-center">
                    <Calendar className="absolute left-4 w-5 h-5 text-slate-400" />
                    <input
                      id="dateOfBirth"
                      type="date"
                      {...register('dateOfBirth')}
                      className={`w-full pl-12 pr-4 py-3 ${isMobile ? 'bg-slate-700/50 border border-slate-600/50' : 'backdrop-blur-xl bg-white/10 border border-white/20'} rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 shadow-lg`}
                    />
                  </div>
                </div>
                {errors.dateOfBirth && (
                  <p className="mt-2 text-sm text-red-300 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-1" />
                    {errors.dateOfBirth.message}
                  </p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-slate-200 mb-2">
                  Password
                </label>
                <div className="relative group">
                  {!isMobile && (
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-300"></div>
                  )}
                  <div className="relative flex items-center">
                    <Lock className="absolute left-4 w-5 h-5 text-slate-400" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      {...register('password')}
                      className={`w-full pl-12 pr-12 py-3 ${isMobile ? 'bg-slate-700/50 border border-slate-600/50' : 'backdrop-blur-xl bg-white/10 border border-white/20'} rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 shadow-lg`}
                      placeholder="Create a strong password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className={`absolute right-4 text-slate-400 ${!isMobile ? 'hover:text-white' : ''} transition-colors duration-200 touch-manipulation`}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
                {password && (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center space-x-3">
                      <div className="flex-1 bg-slate-700/50 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${isMobile ? 'transition-all duration-300' : 'transition-all duration-500'} ${strengthColors[passwordStrength - 1] || 'bg-slate-600'}`}
                          style={{ width: `${(passwordStrength / 5) * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-xs text-slate-300 font-medium min-w-fit">
                        {strengthLabels[passwordStrength - 1] || 'Very Weak'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className={`flex items-center space-x-2 ${password.length >= 8 ? 'text-green-400' : 'text-slate-400'}`}>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>At least 8 characters</span>
                      </div>
                      <div className={`flex items-center space-x-2 ${/[a-z]/.test(password) ? 'text-green-400' : 'text-slate-400'}`}>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>One lowercase letter</span>
                      </div>
                      <div className={`flex items-center space-x-2 ${/[A-Z]/.test(password) ? 'text-green-400' : 'text-slate-400'}`}>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>One uppercase letter</span>
                      </div>
                      <div className={`flex items-center space-x-2 ${/\d/.test(password) ? 'text-green-400' : 'text-slate-400'}`}>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>One number</span>
                      </div>
                      <div className={`flex items-center space-x-2 col-span-1 sm:col-span-2 ${/[^\w\s]/.test(password) ? 'text-green-400' : 'text-slate-400'}`}>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>One special character</span>
                      </div>
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

              {/* Confirm Password Field */}
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-slate-200 mb-2">
                  Confirm Password
                </label>
                <div className="relative group">
                  {!isMobile && (
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-300"></div>
                  )}
                  <div className="relative flex items-center">
                    <Lock className="absolute left-4 w-5 h-5 text-slate-400" />
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      {...register('confirmPassword')}
                      className={`w-full pl-12 pr-12 py-3 ${isMobile ? 'bg-slate-700/50 border border-slate-600/50' : 'backdrop-blur-xl bg-white/10 border border-white/20'} rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 shadow-lg`}
                      placeholder="Confirm your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className={`absolute right-4 text-slate-400 ${!isMobile ? 'hover:text-white' : ''} transition-colors duration-200 touch-manipulation`}
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
                {errors.confirmPassword && (
                  <p className="mt-2 text-sm text-red-300 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-1" />
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>

              {/* Terms and Conditions */}
              <div className="flex items-start space-x-3">
                <div className="flex items-center h-5 mt-1">
                  <input
                    id="agreeToTerms"
                    type="checkbox"
                    {...register('agreeToTerms')}
                    className="h-4 w-4 rounded border-white/20 bg-white/10 text-purple-600 focus:ring-purple-500/50 focus:ring-2 focus:ring-offset-0"
                  />
                </div>
                <div className="text-sm">
                  <label htmlFor="agreeToTerms" className="text-slate-300 leading-relaxed">
                    I agree to the{' '}
                    <Link href="/terms" className={`text-purple-400 ${!isMobile ? 'hover:text-purple-300' : ''} underline underline-offset-2 transition-colors touch-manipulation`}>
                      Terms and Conditions
                    </Link>{' '}
                    and{' '}
                    <Link href="/privacy" className={`text-purple-400 ${!isMobile ? 'hover:text-purple-300' : ''} underline underline-offset-2 transition-colors touch-manipulation`}>
                      Privacy Policy
                    </Link>
                  </label>
                </div>
              </div>
              {errors.agreeToTerms && (
                <p className="mt-2 text-sm text-red-300 flex items-center">
                  <AlertCircle className="w-4 h-4 mr-1" />
                  {errors.agreeToTerms.message}
                </p>
              )}

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`group relative w-full flex justify-center py-4 px-6 border border-transparent text-sm font-bold rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-2 focus:ring-offset-transparent transition-all duration-200 shadow-lg bg-gradient-to-r from-purple-600 to-blue-600 ${!isMobile ? 'hover:from-purple-700 hover:to-blue-700 transform hover:scale-[1.02]' : ''} active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none touch-manipulation`}
                >
                  {!isMobile && (
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl blur opacity-0 group-hover:opacity-50 transition duration-300"></div>
                  )}
                  <span className="relative flex items-center">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" />
                        Creating Account...
                      </>
                    ) : (
                      <>
                        Create Account
                        <ArrowRight className={`ml-2 w-5 h-5 ${!isMobile ? 'group-hover:translate-x-1' : ''} transition-transform`} />
                      </>
                    )}
                  </span>
                </button>
              </div>
            </form>

            {/* Additional Links */}
            <div className="mt-8 space-y-4">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/20" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className={`px-4 ${isMobile ? 'bg-slate-800/90' : 'backdrop-blur-xl bg-slate-900/50'} text-slate-400 rounded-full`}>Already have an account?</span>
                </div>
              </div>

              <div>
                <Link
                  href="/login"
                  className={`group w-full flex justify-center py-3 px-6 border border-white/20 rounded-xl shadow-lg text-sm font-semibold text-white ${isMobile ? 'bg-slate-700/50 hover:bg-slate-600/50' : 'backdrop-blur-xl bg-white/5 hover:bg-white/10'} focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 ${!isMobile ? 'transform hover:scale-[1.02]' : ''}`}
                >
                  <span className="flex items-center">
                    <LogIn className="mr-2 w-4 h-4" />
                    Sign in to existing account
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}