'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

const BACK_ONLINE_MS = 4000;

/** A strip across the top of every page while the device has no internet, then "back online" briefly. */
export default function OfflineBanner() {
    const online = useOnlineStatus();
    const [backOnline, setBackOnline] = useState(false);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onOnline = () => {
            clearTimeout(timer);
            setBackOnline(true);
            timer = setTimeout(() => setBackOnline(false), BACK_ONLINE_MS);
        };
        const onOffline = () => {
            clearTimeout(timer);
            setBackOnline(false);
        };
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, []);

    if (online && !backOnline) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className={`fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white shadow-lg ${
                online ? 'bg-emerald-600' : 'bg-red-600'
            }`}
        >
            {online ? (
                <>
                    <Wifi className="h-4 w-4 shrink-0" aria-hidden />
                    You&apos;re back online.
                </>
            ) : (
                <>
                    <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
                    No internet connection. Check your Wi-Fi or mobile data.
                </>
            )}
        </div>
    );
}
