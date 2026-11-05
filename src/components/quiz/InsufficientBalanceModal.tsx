'use client';

import { AlertTriangle, Wallet } from 'lucide-react';
import {
  MODAL_BACKDROP_CLASS,
  MODAL_PANEL_CLASS,
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_ICON_BADGE_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
} from './modal-classes';

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
    <div className={MODAL_BACKDROP_CLASS}>
      <div className={MODAL_PANEL_CLASS}>
        {/* Close button */}
        <button
          onClick={onClose}
          className={MODAL_CLOSE_BUTTON_CLASS}
        >
          <span className="text-xl">×</span>
        </button>

        <div className="text-center mb-6">
          <div className={`${MODAL_ICON_BADGE_CLASS} from-amber-500 to-orange-500`}>
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
            className={MODAL_SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            onClick={handleGoToWallet}
            className={`${MODAL_PRIMARY_BUTTON_CLASS} from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 flex items-center justify-center gap-2`}
          >
            <Wallet className="w-5 h-5" />
            Manage Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
