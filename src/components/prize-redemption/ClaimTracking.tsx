'use client';

import { useState } from 'react';
import {
    ANTI_SCAM_NOTICE,
    PLAYER_EVENT_LABELS,
    formatHandoverCode,
    type PlayerClaimEvent,
} from '@/lib/claim-tracking-shared';

interface ClaimTrackingProps {
    trackingId?: string | null;
    /** Only while the claim is approved (the prize is on its way) */
    handoverCode?: string | null;
    timeline?: PlayerClaimEvent[];
}

/**
 * The winner's view of a claim: the tracking ID to quote, the handover code while the prize is on its
 * way, and what has happened so far. Shared by the profile's won prizes and the redemption history.
 */
export function ClaimTracking({ trackingId, handoverCode, timeline = [] }: ClaimTrackingProps) {
    const [open, setOpen] = useState(false);
    if (!trackingId) return null;

    return (
        <div className="mt-3 space-y-2 text-sm">
            <p className="text-slate-200">
                Tracking ID <span className="font-mono tracking-wider text-white">{trackingId}</span>
            </p>
            {handoverCode && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <p className="text-xs text-emerald-200">Handover code</p>
                    <p className="font-mono text-2xl tracking-[0.3em] text-white" aria-label={`Handover code ${handoverCode.split('').join(' ')}`}>
                        {formatHandoverCode(handoverCode)}
                    </p>
                    <p className="text-xs text-emerald-100/80">Give it to the person handing you the prize, once it is in your hands.</p>
                </div>
            )}
            <p className="text-xs text-slate-200">{ANTI_SCAM_NOTICE}</p>
            {timeline.length > 0 && (
                <div>
                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={open}
                        className="text-xs font-medium text-slate-100 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 rounded"
                    >
                        {open ? 'Hide history' : 'Show history'}
                    </button>
                    {open && (
                        <ol className="mt-2 space-y-1 border-l border-white/20 pl-3">
                            {timeline.map((step, i) => (
                                <li key={`${step.event}-${i}`} className={step.event === 'handover_failed' ? 'text-rose-200' : 'text-white'}>
                                    <span className="text-slate-300">{new Date(step.at).toLocaleString()}</span> {PLAYER_EVENT_LABELS[step.event]}
                                    {step.event === 'handover_failed' && (
                                        <span className="block text-xs text-rose-200/80">If nobody asked you for your code, contact support.</span>
                                    )}
                                    {step.note && <span className="block text-xs text-slate-200">{step.note}</span>}
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            )}
        </div>
    );
}
