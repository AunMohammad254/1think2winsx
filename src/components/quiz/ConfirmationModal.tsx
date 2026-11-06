'use client';

import { Wallet } from 'lucide-react';
import BaseModal from './BaseModal';
import {
  MODAL_ICON_BADGE_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SPINNER_CLASS,
} from './modal-classes';

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
  return (
    <BaseModal isOpen={isOpen} onClose={onClose}>
        <div className="text-center mb-6">
          <div className={`${MODAL_ICON_BADGE_CLASS} from-green-500 to-emerald-500`}>
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
            className={MODAL_SECONDARY_BUTTON_CLASS}
          >
            Back
          </button>
          <button
            onClick={handleConfirmedPayment}
            disabled={paymentLoading}
            className={`${MODAL_PRIMARY_BUTTON_CLASS} from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {paymentLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className={MODAL_SPINNER_CLASS} />
                Processing...
              </div>
            ) : (
              'Confirm Payment'
            )}
          </button>
        </div>
    </BaseModal>
  );
}
