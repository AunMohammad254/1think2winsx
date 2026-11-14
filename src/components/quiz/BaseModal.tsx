'use client';

import {
  MODAL_BACKDROP_CLASS,
  MODAL_PANEL_CLASS,
  MODAL_CLOSE_BUTTON_CLASS,
} from './modal-classes';

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function BaseModal({ isOpen, onClose, children }: BaseModalProps) {
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

        {children}
      </div>
    </div>
  );
}
