import React, { useState } from 'react';

interface PaymentSectionProps {
  quizId: string;
  onPaymentSuccess?: () => void;
  onClose?: () => void;
}

export default function PaymentSection({ quizId, onPaymentSuccess, onClose }: PaymentSectionProps) {
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const getCSRFToken = async () => {
    try {
      const response = await fetch('/api/csrf-token');
      if (!response.ok) {
        throw new Error('Failed to fetch CSRF token');
      }
      const data = await response.json();
      return data.csrfToken;
    } catch (error) {
      console.error('Failed to get CSRF token:', error);
      return null;
    }
  };

  const handleDailyPayment = async () => {
    setPaymentStatus('processing');
    setError(null);
    
    try {
      const csrfToken = await getCSRFToken();
      if (!csrfToken) {
        throw new Error('Failed to obtain security token. Please try again.');
      }

      const response = await fetch('/api/daily-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          amount: 2.0,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Daily payment failed');
      }
      
      const data = await response.json();
      
      if (data.payment.status === 'completed') {
        setPaymentStatus('success');
        onPaymentSuccess?.();
      } else {
        throw new Error('Daily payment failed. Please try again.');
      }
    } catch (error) {
      console.error('Daily payment error:', error);
      setError(error instanceof Error ? error.message : 'Daily payment failed. Please try again.');
      setPaymentStatus('error');
    }
  };

  const handleQuizPayment = async () => {
    setPaymentStatus('processing');
    setError(null);
    
    try {
      const csrfToken = await getCSRFToken();
      if (!csrfToken) {
        throw new Error('Failed to obtain security token. Please try again.');
      }

      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          quizId: quizId,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Payment failed');
      }
      
      await response.json();
      setPaymentStatus('success');
      onPaymentSuccess?.();
    } catch (error) {
      console.error('Payment error:', error);
      setError(error instanceof Error ? error.message : 'Payment failed. Please try again.');
      setPaymentStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white/10 border border-white/20 rounded-2xl shadow-2xl backdrop-blur-xl max-w-md w-full mx-auto overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600/20 to-pink-600/20 p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">Choose Payment Option</h2>
            {onClose && (
              <button
                onClick={onClose}
                className="text-white/60 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <p className="text-white/80 mt-2">Select how you&apos;d like to access the quiz</p>
        </div>

        {/* Payment Options */}
        <div className="p-6 space-y-4">
          {/* Daily Access Option */}
          <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Daily Access</h3>
                <p className="text-white/70 text-sm">Access all quizzes for 24 hours</p>
              </div>
              <span className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">2 PKR</span>
            </div>
            <button
              onClick={handleDailyPayment}
              disabled={paymentStatus === 'processing'}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold py-3 px-4 rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {paymentStatus === 'processing' ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Processing...
                </div>
              ) : (
                'Get Daily Access'
              )}
            </button>
          </div>

          {/* Single Quiz Option */}
          <div className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/20 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Single Quiz</h3>
                <p className="text-white/70 text-sm">Access this quiz only</p>
              </div>
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">2 PKR</span>
            </div>
            <button
              onClick={handleQuizPayment}
              disabled={paymentStatus === 'processing'}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-semibold py-3 px-4 rounded-lg hover:from-blue-700 hover:to-cyan-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {paymentStatus === 'processing' ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Processing...
                </div>
              ) : (
                'Pay for This Quiz'
              )}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {paymentStatus === 'success' && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
              <p className="text-green-400 text-sm">Payment successful! You can now access the quiz.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}