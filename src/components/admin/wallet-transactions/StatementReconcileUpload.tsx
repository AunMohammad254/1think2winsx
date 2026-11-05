'use client';

import { useRef, type ChangeEvent } from 'react';
import { Loader2, UploadCloud } from 'lucide-react';

interface StatementReconcileUploadProps {
    isReconciling: boolean;
    /** Uploads the bank statement and reports the result; never rejects */
    onReconcile: (file: File) => Promise<void>;
}

/** The hidden statement file input and the button that opens it */
export default function StatementReconcileUpload({ isReconciling, onReconcile }: StatementReconcileUploadProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        await onReconcile(file);
        fileInputRef.current!.value = ''; // the file input is always rendered
    };

    return (
        <>
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleChange}
                accept=".pdf,.csv,.md,.txt"
                className="hidden"
            />
            <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isReconciling}
                className="px-4 py-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-all text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                title="Reconcile bank statement (PDF/CSV/TXT) — auto-matches and approves deposits"
            >
                {isReconciling ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                <span className="hidden sm:inline">Reconcile Statement</span>
            </button>
        </>
    );
}
