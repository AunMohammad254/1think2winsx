'use client';

import { Sparkles, CheckCircle } from 'lucide-react';
import {
  MODAL_BACKDROP_CLASS,
  MODAL_PANEL_CLASS,
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_ICON_BADGE_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SPINNER_CLASS,
} from './modal-classes';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessPrice: number;
  paymentLoading: boolean;
  handlePayNowClick: () => void;
}

export default function PaymentModal({
  isOpen,
  onClose,
  accessPrice,
  paymentLoading,
  handlePayNowClick,
}: PaymentModalProps) {
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
          <div className={`${MODAL_ICON_BADGE_CLASS} from-purple-500 to-pink-500`}>
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">Unlock Arena Access</h3>
          <p className="text-gray-400">
            Unlock unlimited access to all quizzes
          </p>
        </div>

        <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-gray-300">24-Hour Full Access</span>
            <span className="text-3xl font-bold text-white">{accessPrice} PKR</span>
          </div>
          <ul className="text-sm text-gray-400 space-y-2">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400 animate-pulse" />
              Unlimited quiz attempts
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              Access all active quizzes
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              Compete for prizes
            </li>
          </ul>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className={MODAL_SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            onClick={handlePayNowClick}
            disabled={paymentLoading}
            className={`${MODAL_PRIMARY_BUTTON_CLASS} from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {paymentLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className={MODAL_SPINNER_CLASS} />
                Checking...
              </div>
            ) : (
              'Pay Now'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
