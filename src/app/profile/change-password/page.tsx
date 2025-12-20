'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { validatePasswordData, sanitizeInput, formatErrorMessage } from '@/utils/validation';
import Link from 'next/link';

type PasswordFormData = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export default function ChangePasswordPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [formData, setFormData] = useState<PasswordFormData>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });

  useEffect(() => {
    // Redirect to login if not authenticated
    if (!isLoading && !user) {
      router.push('/login?callbackUrl=/profile/change-password');
      return;
    }
  }, [isLoading, user, router]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear messages when user starts typing
    if (error) setError(null);
    if (success) setSuccess(null);
  };

  const togglePasswordVisibility = (field: keyof typeof showPasswords) => {
    setShowPasswords(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const _validatePassword = (password: string): string | null => {
    if (password.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    if (!/(?=.*[a-z])/.test(password)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/(?=.*[A-Z])/.test(password)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/(?=.*\d)/.test(password)) {
      return 'Password must contain at least one number';
    }
    if (!/(?=.*[@$!%*?&])/.test(password)) {
      return 'Password must contain at least one special character (@$!%*?&)';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Sanitize input data
      const sanitizedData = {
        currentPassword: sanitizeInput(formData.currentPassword),
        newPassword: sanitizeInput(formData.newPassword),
        confirmPassword: sanitizeInput(formData.confirmPassword)
      };

      // Validate form data
      const validation = validatePasswordData(sanitizedData);
      if (!validation.isValid) {
        throw new Error(formatErrorMessage(validation.errors));
      }

      // Get CSRF token
      const getCSRFToken = async () => {
        const csrfResponse = await fetch('/api/csrf-token', {
          credentials: 'include'
        });
        if (!csrfResponse.ok) {
          throw new Error('Failed to get CSRF token');
        }
        const csrfData = await csrfResponse.json();
        return csrfData.csrfToken;
      };

      const csrfToken = await getCSRFToken();

      const response = await fetch('/api/profile/change-password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: sanitizedData.currentPassword,
          newPassword: sanitizedData.newPassword
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to change password');
      }

      setSuccess('Password changed successfully!');

      // Clear form
      setFormData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });

      // Redirect to profile page after a short delay
      setTimeout(() => {
        router.push('/profile');
      }, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="relative">
          <div className="md:animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-purple-400"></div>
          <div className="hidden md:block absolute inset-0 md:animate-ping rounded-full h-16 w-16 border-2 border-purple-300 opacity-20"></div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background: `
          radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.3) 0%, transparent 50%),
          radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.3) 0%, transparent 50%),
          radial-gradient(circle at 40% 40%, rgba(120, 219, 255, 0.2) 0%, transparent 50%),
          linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)
        `
      }}
    >
      {/* Animated Background Elements - Desktop only */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="hidden md:block absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
        <div className="hidden md:block absolute -bottom-40 -left-40 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
        <div className="hidden md:block absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse animation-delay-4000"></div>

        {/* Mobile simplified background */}
        <div className="md:hidden absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5"></div>
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo and Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block group">
            <div className="relative">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-2 md:group-hover:scale-105 md:transition-transform md:duration-300">
                1think2win
              </h1>
              <div className="hidden md:block absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg blur opacity-20 md:group-hover:opacity-40 md:transition md:duration-300"></div>
            </div>
          </Link>
          <p className="text-gray-300 text-lg font-medium">Change Your Password</p>
          <Link
            href="/profile"
            className="inline-flex items-center text-purple-400 md:hover:text-purple-300 md:transition-colors mt-2 text-sm touch-manipulation"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Profile
          </Link>
        </div>

        {/* Main Form Card */}
        <div className="md:backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl p-8 relative overflow-hidden">
          {/* Card Glow Effect */}
          <div className="hidden md:block absolute inset-0 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-blue-500/10 rounded-2xl"></div>

          <div className="relative z-10">
            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/20 border border-red-500/30 md:backdrop-blur-sm">
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-red-400 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-red-200 text-sm font-medium">{error}</p>
                </div>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="mb-6 p-4 rounded-xl bg-green-500/20 border border-green-500/30 md:backdrop-blur-sm">
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-green-400 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-green-200 text-sm font-medium">{success}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Current Password Field */}
              <div className="space-y-2">
                <label htmlFor="currentPassword" className="block text-sm font-semibold text-gray-200">
                  Current Password
                </label>
                <div className="relative group">
                  <input
                    type={showPasswords.current ? 'text' : 'password'}
                    id="currentPassword"
                    name="currentPassword"
                    value={formData.currentPassword}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-300 md:backdrop-blur-sm md:group-hover:bg-white/10 touch-manipulation"
                    placeholder="Enter your current password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('current')}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 md:hover:text-purple-400 transition-colors touch-manipulation"
                  >
                    {showPasswords.current ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                  <div className="hidden md:block absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                </div>
              </div>

              {/* New Password Field */}
              <div className="space-y-2">
                <label htmlFor="newPassword" className="block text-sm font-semibold text-gray-200">
                  New Password
                </label>
                <div className="relative group">
                  <input
                    type={showPasswords.new ? 'text' : 'password'}
                    id="newPassword"
                    name="newPassword"
                    value={formData.newPassword}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-300 md:backdrop-blur-sm md:group-hover:bg-white/10 touch-manipulation"
                    placeholder="Enter your new password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('new')}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 md:hover:text-purple-400 transition-colors touch-manipulation"
                  >
                    {showPasswords.new ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                  <div className="hidden md:block absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                </div>
                <div className="mt-2 text-xs text-gray-400 bg-white/5 rounded-lg p-2 md:backdrop-blur-sm">
                  Password must be at least 8 characters with uppercase, lowercase, number, and special character.
                </div>
              </div>

              {/* Confirm Password Field */}
              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-200">
                  Confirm New Password
                </label>
                <div className="relative group">
                  <input
                    type={showPasswords.confirm ? 'text' : 'password'}
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-300 md:backdrop-blur-sm md:group-hover:bg-white/10 touch-manipulation"
                    placeholder="Confirm your new password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('confirm')}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 md:hover:text-purple-400 transition-colors touch-manipulation"
                  >
                    {showPasswords.confirm ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                  <div className="hidden md:block absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4 pt-6">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 relative group overflow-hidden rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-3 text-white font-semibold shadow-lg transition-all duration-300 md:hover:shadow-purple-500/25 md:hover:shadow-xl md:hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 touch-manipulation"
                >
                  <span className="relative z-10 flex items-center justify-center">
                    {loading ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Changing Password...
                      </>
                    ) : (
                      'Change Password'
                    )}
                  </span>
                  <div className="hidden md:block absolute inset-0 bg-gradient-to-r from-purple-700 to-pink-700 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </button>

                <Link
                  href="/profile"
                  className="flex-1 relative group overflow-hidden rounded-xl bg-white/10 border border-white/20 px-6 py-3 text-gray-200 font-semibold text-center transition-all duration-300 md:hover:bg-white/20 md:hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white/50 md:backdrop-blur-sm touch-manipulation"
                >
                  <span className="relative z-10">Cancel</span>
                  <div className="hidden md:block absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}