'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toaster } from 'sonner';

/**
 * The app's toasts. While an element is in fullscreen (the live stream) the browser draws only that
 * element, so toasts like "Answer locked in!" move inside it; otherwise they render here as before.
 * Moving remounts the Toaster, which drops toasts already on screen at that moment.
 */
export default function AppToaster() {
  const [host, setHost] = useState<Element | null>(null);

  useEffect(() => {
    const getFullscreenHost = () =>
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      document.querySelector('[data-stream-fullscreen]');

    const onChange = () => setHost(getFullscreenHost());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);

    // Initial check for any already-active fullscreen element or attribute
    onChange();

    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toaster = <Toaster position="top-right" richColors closeButton />;
  return host ? createPortal(toaster, host) : toaster;
}
