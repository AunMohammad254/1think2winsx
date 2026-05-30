'use client';

import { AlertTriangle, Wallet } from 'lucide-react';

interface InsufficientBalanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletBalance: number;
  accessPrice: number;
  handleGoToWallet: () => void;
}

export default function InsufficientBalanceModal({
  isOpen,
  onClose,
  walletBalance,
  accessPrice,
  handleGoToWallet,
}: InsufficientBalanceModalProps) {
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
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">Insufficient Balance</h3>
          <p className="text-gray-400">
            Please add funds to your wallet
          </p>
        </div>

        <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-2xl p-6 mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-300">Current Balance</span>
            <span className="text-xl font-bold text-red-400">{walletBalance.toFixed(2)} PKR</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-300">Required Amount</span>
            <span className="text-xl font-bold text-white">{accessPrice.toFixed(2)} PKR</span>
          </div>
          <div className="border-t border-white/10 pt-3 flex items-center justify-between">
            <span className="text-gray-300">Amount Needed</span>
            <span className="text-xl font-bold text-amber-400">{(accessPrice - walletBalance).toFixed(2)} PKR</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGoToWallet}
            className="flex-1 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 transition-all flex items-center justify-center gap-2"
          >
            <Wallet className="w-5 h-5" />
            Manage Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
