'use client';

import { XCircle, Loader2 } from 'lucide-react';

interface RejectModalProps {
    notes: string;
    onNotesChange: (notes: string) => void;
    isRejecting: boolean;
    /** Closes the modal and clears the notes (Cancel or a backdrop click) */
    onClose: () => void;
    onConfirm: () => void;
}

/** Asks for the rejection reason, for one deposit or for the bulk selection */
export default function RejectModal({ notes, onNotesChange, isRejecting, onClose, onConfirm }: RejectModalProps) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="bg-linear-to-br from-gray-900 to-gray-800 border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 rounded-xl bg-red-500/20">
                        <XCircle className="w-6 h-6 text-red-400" />
                    </div>
                    <h3 className="text-xl font-bold text-white">Reject Deposit</h3>
                </div>

                <p className="text-gray-400 text-sm mb-4">
                    Please provide a reason for rejection. This will be visible to the user.
                </p>

                <textarea
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    placeholder="e.g., Invalid transaction ID, amount mismatch, duplicate request..."
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/25 resize-none"
                    rows={3}
                    autoFocus
                />

                <div className="flex gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-3 bg-white/5 border border-white/10 text-gray-300 rounded-xl hover:bg-white/10 transition-all duration-200 font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isRejecting}
                        className="flex-1 px-4 py-3 bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl hover:bg-red-500/30 transition-all duration-200 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {isRejecting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <XCircle className="w-4 h-4" />
                                Reject Deposit
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
