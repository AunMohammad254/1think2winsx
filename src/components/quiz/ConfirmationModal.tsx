'use client';

import { Wallet } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletBalance: number;
  accessPrice: number;
  paymentLoading: boolean;
  handleConfirmedPayment: () => void;
  onBack: () => void;
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  walletBalance,
  accessPrice,
  paymentLoading,
  handleConfirmedPayment,
  onBack,
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="relative w-full max-w-md bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-white/10 p-8">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <span className="text-xl">×</span>
        </button>

        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
            <Wallet className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">Confirm Payment</h3>
          <p className="text-gray-400">
            Deduct from your wallet balance
          </p>
        </div>

        <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl p-6 mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-300">Current Balance</span>
            <span className="text-xl font-bold text-white">{walletBalance.toFixed(2)} PKR</span>
          </div>
          <div className="flex items-center justify-between text-red-400">
            <span>Amount to Deduct</span>
            <span className="font-semibold">- {accessPrice.toFixed(2)} PKR</span>
          </div>
          <div className="border-t border-white/10 pt-3 flex items-center justify-between">
            <span className="text-gray-300">Remaining Balance</span>
            <span className="text-xl font-bold text-green-400">{(walletBalance - accessPrice).toFixed(2)} PKR</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleConfirmedPayment}
            disabled={paymentLoading}
            className="flex-1 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {paymentLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </div>
            ) : (
              'Confirm Payment'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
