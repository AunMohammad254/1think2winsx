'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { Mail, Lock, Eye, EyeOff, AlertCircle, CheckCircle2, Info, Loader2, LogIn } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const supabase = createClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      rememberMe: false,
    },
  });

  useEffect(() => {
    // Check if user just registered
    const registered = searchParams.get('registered');
    if (registered === 'true') {
      setSuccessMessage('Registration successful! Please check your email to verify your account.');
    }

    // Check for password reset success
    const passwordReset = searchParams.get('password_reset');
    if (passwordReset === 'success') {
      setSuccessMessage('Password updated successfully! Please log in with your new password.');
    }

    // Check for error from auth callback
    const errorParam = searchParams.get('error');
    if (errorParam === 'auth_callback_error') {
      setError('Authentication failed. Please try again.');
    }
  }, [searchParams]);

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setError('Invalid email or password');
        } else if (error.message.includes('Email not confirmed')) {
          setError('Please verify your email before logging in');
        } else {
          setError(error.message);
        }
      } else {
        // Redirect to dashboard or specified redirect path
        const redirect = searchParams.get('redirect') || '/quizzes';
        router.push(redirect);
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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/quizzes`,
        },
      });

      if (error) {
        setError(error.message);
        setIsGoogleLoading(false);
      }
    } catch {
      setError('An error occurred during Google sign-in');
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Optimized Background - Matches hero section gradient */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.02'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      >
        {/* Simplified background effects - Desktop only */}
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-blue-500/5 to-pink-500/5 hidden md:block md:animate-pulse"></div>
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl hidden md:block md:animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl hidden md:block md:animate-pulse delay-1000"></div>

        {/* Mobile-friendly static background */}
        <div className="absolute inset-0 md:hidden bg-gradient-to-br from-purple-500/5 to-blue-500/5"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <Link href="/" className="group touch-manipulation">
              <div className="relative">
                {/* Simplified logo effect for mobile */}
                <div className="absolute -inset-2 bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 rounded-full blur opacity-75 hidden md:block md:group-hover:opacity-100 transition duration-300"></div>
                <div className="relative">
                  <Image
                    src="/cricket-ball.svg"
                    alt="TBCL Logo"
                    width={80}
                    height={80}
                    className="rounded-full bg-white/5 md:bg-white/10 md:backdrop-blur-xl p-2 border border-white/10 md:border-white/20 shadow-lg md:shadow-2xl transform md:group-hover:scale-110 transition-all duration-300"
                  />
                </div>
              </div>
            </Link>
          </div>

          {/* Header */}
          <div className="text-center mb-8">
            <h2 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 bg-clip-text text-transparent mb-4">
              Welcome Back
            </h2>
            <p className="text-slate-300 text-lg">
              Sign in to continue your quiz journey
            </p>
            <p className="mt-4 text-slate-400">
              Don&rsquo;t have an account?{' '}
              <Link href="/register" className="font-semibold text-purple-400 md:hover:text-purple-300 transition-colors duration-200 touch-manipulation">
                Register now
              </Link>
            </p>
          </div>
        </div>

        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          {/* Login Card - Optimized for mobile */}
          <div className="bg-white/5 md:backdrop-blur-xl md:bg-white/10 border border-white/10 md:border-white/20 rounded-2xl shadow-lg md:shadow-2xl p-8">
            {/* Error Message */}
            {error && (
              <div className="mb-6 bg-red-500/10 md:backdrop-blur-xl md:bg-red-500/20 border border-red-500/20 md:border-red-500/30 text-red-100 px-4 py-3 rounded-xl shadow-lg">
                <div className="flex items-center">
                  <AlertCircle className="w-5 h-5 mr-3 text-red-300" />
                  <span className="block sm:inline">{error}</span>
                </div>
              </div>
            )}

            {/* Success Message */}
            {successMessage && (
              <div className="mb-6 bg-green-500/10 md:backdrop-blur-xl md:bg-green-500/20 border border-green-500/20 md:border-green-500/30 text-green-100 px-4 py-3 rounded-xl shadow-lg">
                <div className="flex items-center">
                  <CheckCircle2 className="w-5 h-5 mr-3 text-green-300" />
                  <span className="block sm:inline">{successMessage}</span>
                </div>
              </div>
            )}

            <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
              {/* Email Field */}
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-200 mb-2">
                  Email Address
                </label>
                <div className="relative group">
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-xl blur opacity-0 hidden md:block md:group-hover:opacity-100 transition duration-300"></div>
                  <div className="relative flex items-center">
                    <Mail className="absolute left-4 w-5 h-5 text-slate-400" />
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      {...register('email')}
                      suppressHydrationWarning
                      className="w-full pl-12 pr-4 py-3 bg-white/5 md:backdrop-blur-xl md:bg-white/10 border border-white/10 md:border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 shadow-lg"
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

              {/* Password Field */}
              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-slate-200 mb-2">
                  Password
                </label>
                <div className="relative group">
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-xl blur opacity-0 hidden md:block md:group-hover:opacity-100 transition duration-300"></div>
                  <div className="relative flex items-center">
                    <Lock className="absolute left-4 w-5 h-5 text-slate-400" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      {...register('password')}
                      className="w-full pl-12 pr-12 py-3 bg-white/5 md:backdrop-blur-xl md:bg-white/10 border border-white/10 md:border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200 shadow-lg"
                      placeholder="Enter your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 text-slate-400 md:hover:text-white transition-colors duration-200 touch-manipulation"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
                {errors.password && (
                  <p className="mt-2 text-sm text-red-300 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-1" />
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* Remember Me & Forgot Password */}
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="rememberMe"
                    type="checkbox"
                    {...register('rememberMe')}
                    className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-white/20 rounded bg-white/5 md:bg-white/10 md:backdrop-blur-xl"
                  />
                  <label htmlFor="rememberMe" className="ml-2 block text-sm text-slate-300">
                    Remember me
                  </label>
                </div>

                <div className="text-sm">
                  <Link href="/forgot-password" className="font-semibold text-purple-400 md:hover:text-purple-300 transition-colors duration-200 touch-manipulation">
                    Forgot password?
                  </Link>
                </div>
              </div>

              {/* Submit Button */}
              <div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="group relative w-full flex justify-center py-3 px-4 border border-transparent rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 md:hover:from-purple-700 md:hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transform md:hover:scale-105 transition-all duration-200 shadow-lg md:hover:shadow-purple-500/25 touch-manipulation"
                >
                  <span className="absolute left-0 inset-y-0 flex items-center pl-3">
                    {isSubmitting ? (
                      <Loader2 className="h-5 w-5 text-white animate-spin" />
                    ) : (
                      <LogIn className="h-5 w-5 text-purple-300 group-hover:text-white transition-colors duration-200" />
                    )}
                  </span>
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                </button>
              </div>
            </form>

            {/* Divider */}
            <div className="relative mt-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/20"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white/5 md:backdrop-blur-xl md:bg-white/10 text-slate-400">Or continue with</span>
              </div>
            </div>

            {/* Google Sign-in Button */}
            <div className="mt-6">
              <button
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading || isSubmitting}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-white/20 rounded-xl shadow-lg text-sm font-semibold text-white bg-white/5 md:backdrop-blur-xl md:bg-white/10 md:hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
              >
                {isGoogleLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
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
              </button>
            </div>

            {/* Additional Links */}
            <div className="mt-8 pt-6 border-t border-white/10">
              <div className="text-center space-y-3">
                <p className="text-slate-400 text-sm">New to Kheelo Or Jeeto?</p>
                <Link
                  href="/how-to-play"
                  className="inline-flex items-center text-sm text-blue-400 md:hover:text-blue-300 transition-colors duration-200 touch-manipulation"
                >
                  <Info className="w-4 h-4 mr-2" />
                  Learn how to play →
                </Link>
                <div className="pt-2">
                  <Link
                    href="/forgot-email"
                    className="text-sm text-slate-400 md:hover:text-slate-300 transition-colors duration-200 touch-manipulation"
                  >
                    Forgot your email? Recover via phone →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <div className="w-15 h-15 bg-white/10 rounded-full animate-pulse"></div>
          </div>
          <div className="mt-6 text-center">
            <div className="h-8 bg-white/10 rounded animate-pulse"></div>
          </div>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}