'use client';

import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** A line under the title, read out with it (for example which prize a form is for) */
  description?: ReactNode;
  /** Shown before the title */
  icon?: ReactNode;
  /** Accessible name of the X button */
  closeLabel?: string;
  /** False while a request is in flight: the X, Escape and a click outside then leave it open */
  dismissible?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The app's dialog. It renders into <body>, so a glass card's backdrop-filter or overflow-hidden can't
 * trap or clip it, and sits centred over a dimmed page with focus kept inside. The X, Escape and a click
 * outside close it. Its body scrolls when it is taller than the screen, so the actions stay reachable.
 */
export function Modal({ open, onClose, title, description, icon, closeLabel = 'Close', dismissible = true, className, children }: ModalProps) {
  const stayOpen = (event: Event) => {
    if (!dismissible) event.preventDefault();
  };

  return (
    // There is no trigger inside, so the only change Radix reports is a close
    <DialogPrimitive.Root open={open} onOpenChange={onClose}>
      <DialogPrimitive.Portal>
        {/* Above the chatbot's floating button (z-[9999]); toasts still show on top */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <DialogPrimitive.Content
            onEscapeKeyDown={stayOpen}
            onPointerDownOutside={stayOpen}
            // Without a description there is nothing to point at (and Radix would warn)
            {...(description ? {} : { 'aria-describedby': undefined })}
            className={cn(
              'flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900 shadow-2xl focus:outline-none',
              className,
            )}
          >
            <div className="flex shrink-0 items-start gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
              {icon}
              <div className="min-w-0 flex-1 self-center">
                <DialogPrimitive.Title className="text-lg font-bold text-white break-words">{title}</DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="mt-0.5 text-sm text-slate-400 break-words">{description}</DialogPrimitive.Description>
                )}
              </div>
              <DialogPrimitive.Close
                aria-label={closeLabel}
                disabled={!dismissible}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
