'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import logger from '@/lib/logger';

interface PWAContextType {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstallable: boolean;
  isInstalled: boolean;
  installApp: () => Promise<string | null>;
  dismissBanner: () => void;
  isBannerDismissed: boolean;
}

// BeforeInstallPromptEvent is not yet in the TypeScript DOM lib
interface BeforeInstallPromptEvent extends Event {
  prompt(): void;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const PWAContext = createContext<PWAContextType | undefined>(undefined);

export function PWAProvider({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isBannerDismissed, setIsBannerDismissed] = useState(true);

  useEffect(() => {
    // Register service worker immediately on mount
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          logger.log('[PWA Context] Service Worker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.error('[PWA Context] Service Worker registration failed:', err);
        });
    }

    // Check if running in standalone mode (installed)
    const isStandalone = 
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    
    setIsInstalled(isStandalone);

    // Check dismissal status in localStorage
    const dismissedTime = localStorage.getItem('pwa_banner_dismissed');
    if (dismissedTime) {
      if (Date.now() > parseInt(dismissedTime)) {
        localStorage.removeItem('pwa_banner_dismissed');
        setIsBannerDismissed(false);
      } else {
        setIsBannerDismissed(true);
      }
    } else {
      setIsBannerDismissed(false);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstallable(false);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // ⚡ Bolt Performance Optimization:
  // Memoize installApp to maintain referential stability.
  const installApp = React.useCallback(async () => {
    if (!deferredPrompt) return null;

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      setIsInstallable(false);
      return outcome;
    } catch (error) {
      console.error('Failed to trigger PWA install prompt:', error);
      return null;
    }
  }, [deferredPrompt]);

  // ⚡ Bolt Performance Optimization:
  // Memoize dismissBanner to maintain referential stability.
  const dismissBanner = React.useCallback(() => {
    setIsBannerDismissed(true);
    // Dismiss for 7 days
    const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem('pwa_banner_dismissed', expiration.toString());
  }, []);

  // ⚡ Bolt Performance Optimization:
  // Memoize the Context value object to prevent consumers from re-rendering
  // unnecessarily when PWAProvider re-renders due to unrelated state changes.
  // Expected impact: Reduces re-renders of all components utilizing usePWA()
  const value = React.useMemo(() => ({
    deferredPrompt,
    isInstallable,
    isInstalled,
    installApp,
    dismissBanner,
    isBannerDismissed,
  }), [deferredPrompt, isInstallable, isInstalled, installApp, dismissBanner, isBannerDismissed]);

  return (
    <PWAContext.Provider value={value}>
      {children}
    </PWAContext.Provider>
  );
}

export function usePWA() {
  const context = useContext(PWAContext);
  if (context === undefined) {
    throw new Error('usePWA must be used within a PWAProvider');
  }
  return context;
}
