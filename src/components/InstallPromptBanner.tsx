'use client';

import { Sparkles, X, Download } from 'lucide-react';
import { usePWA } from '@/contexts/PWAContext';

export default function InstallPromptBanner() {
  const { isInstallable, isBannerDismissed, installApp, dismissBanner } = usePWA();

  if (!isInstallable || isBannerDismissed) return null;

  const handleInstallClick = async () => {
    const outcome = await installApp();
    console.log(`PWA installation outcome: ${outcome}`);
  };

  const handleDismissClick = () => {
    dismissBanner();
  };


  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-50 animate-fadeIn">
      <div className="glass-card glass-border rounded-2xl p-5 bg-gradient-to-br from-gray-900/95 via-gray-800/90 to-gray-950/95 shadow-2xl backdrop-blur-xl relative overflow-hidden border border-white/10">
        {/* Glowing aura effect */}
        <div className="absolute -top-12 -right-12 w-24 h-24 rounded-full bg-purple-500/10 filter blur-xl" />
        <div className="absolute -bottom-12 -left-12 w-24 h-24 rounded-full bg-blue-500/10 filter blur-xl" />

        <button
          onClick={handleDismissClick}
          className="absolute top-3 right-3 text-gray-400 hover:text-white transition-colors p-1 rounded-full hover:bg-white/5"
          aria-label="Dismiss banner"
        >
          <X className="w-4.5 h-4.5" />
        </button>

        <div className="flex gap-4">
          {/* Logo/Icon Container */}
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0 border border-white/20 shadow-lg shadow-purple-500/20">
            <Sparkles className="w-6 h-6 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-white mb-1 pr-6">Install 1Think2Win App</h4>
            <p className="text-xs text-gray-300 leading-relaxed mb-4">
              Get active cricket quizzes, check leaderboard ranks, and claim your rewards instantly from your home screen!
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleInstallClick}
                className="py-2 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-xs font-bold transition-all duration-200 flex items-center gap-1.5 shadow-md shadow-purple-500/10"
              >
                <Download className="w-3.5 h-3.5" />
                Install Now
              </button>
              <button
                onClick={handleDismissClick}
                className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-gray-300 text-xs font-semibold transition-all duration-200"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
