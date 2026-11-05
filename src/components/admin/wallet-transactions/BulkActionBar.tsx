'use client';

import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface BulkActionBarProps {
    selectedCount: number;
    isProcessing: boolean;
    onClear: () => void;
    onApprove: () => void;
    /** Opens the reject modal for the selection */
    onReject: () => void;
}

export default function BulkActionBar({ selectedCount, isProcessing, onClear, onApprove, onReject }: BulkActionBarProps) {
    return (
        <div className="p-4 bg-blue-900/40 border border-blue-500/30 rounded-xl flex items-center justify-between animate-in slide-in-from-top-4">
            <div className="flex items-center gap-4">
                <span className="text-blue-200 font-medium">{selectedCount} selected</span>
                <button
                    onClick={onClear}
                    className="text-sm text-blue-400 hover:text-blue-300"
                >
                    Clear selection
                </button>
            </div>
            <div className="flex gap-3">
                <button
                    onClick={onApprove}
                    disabled={isProcessing}
                    className="px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-50 flex items-center gap-2"
                >
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Approve Selected
                </button>
                <button
                    onClick={onReject}
                    disabled={isProcessing}
                    className="px-4 py-2 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50 flex items-center gap-2"
                >
                    <XCircle className="w-4 h-4" />
                    Reject Selected
                </button>
            </div>
        </div>
    );
}
