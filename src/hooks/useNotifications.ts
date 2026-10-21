'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getCSRFHeaders } from '@/lib/csrf';
import { toast } from 'sonner';
import { useJitteredPolling } from '@/hooks/useJitteredPolling';
import { NEW_NOTICE_EVENT, UNREAD_COUNT_EVENT } from '@/lib/live-catalog';
import { playChime, SOUND_SETTING_KEY } from '@/lib/notification-sound';

export { playChime };

// The badge's safety-net poll, and how recent a count from the quiz page must be to skip it
const UNREAD_POLL_MS = 5 * 60_000;
const RECENT_COUNT_MS = 4 * 60_000;

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link: string | null;
  createdAt: string;
  updatedAt: string;
}

// Helper to convert base64 VAPID public key to Uint8Array
const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function useNotifications() {
  const { user } = useAuth();
  // Key everything on the id: the `user` object is replaced on token refresh / tab refocus
  const userId = user?.id ?? null;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Latest list for callbacks: reading it inside a setNotifications updater is too late,
  // because React runs updaters after the callback returns
  const notificationsRef = useRef<Notification[]>([]);
  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Sound settings persistent in localStorage
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  // Web Push Subscription states
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default');

  // Ref to track sound setting inside the badge callbacks without re-creating them
  const soundEnabledRef = useRef(soundEnabled);

  useEffect(() => {
    // Sync ref with state
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Load sound setting from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SOUND_SETTING_KEY);
      if (saved !== null) {
        setSoundEnabled(saved === 'true');
      }
    } catch (e) {
      console.warn('LocalStorage not available', e);
    }
  }, []);

  // Set sound setting
  const toggleSound = useCallback((value: boolean) => {
    setSoundEnabled(value);
    try {
      localStorage.setItem(SOUND_SETTING_KEY, String(value));
    } catch (e) {
      console.warn('Could not save sound setting', e);
    }
  }, []);

  // Whether the full list has been loaded for the current user (it is loaded lazily).
  // The ref guards re-fetching; the state lets the UI show a spinner instead of "All caught up!"
  // before the first load.
  const listLoadedRef = useRef(false);
  const [listLoaded, setListLoaded] = useState(false);

  // Fetch the full notification list (+ unread count)
  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/notifications');

      if (!res.ok) {
        if (res.status === 401) {
          setNotifications([]);
          setUnreadCount(0);
          return;
        }
        const errText = await res.text();
        console.error(`[useNotifications] Fetch failed with status ${res.status}:`, errText);
        throw new Error(`Failed to fetch notifications (Status ${res.status})`);
      }

      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
      listLoadedRef.current = true;
      setListLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('[useNotifications] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // The badge count. There is no per-user Realtime subscription: the plan allows 500 connections,
  // and a blast writes one Notification row per user that Supabase would check against every
  // subscriber. The count comes from a slow jittered poll and, on the quiz page, from the personal
  // list it already loads (UNREAD_COUNT_EVENT). New notifications still arrive instantly as Web Push.
  const unreadCountRef = useRef(0);
  // No "new notifications" toast before a first count is known, so loading a page never
  // announces old ones
  const countKnownRef = useRef(false);
  const countReceivedAtRef = useRef(0);
  useEffect(() => {
    unreadCountRef.current = unreadCount;
  }, [unreadCount]);
  const applyUnreadCount = useCallback((next: number) => {
    if (countKnownRef.current && next > unreadCountRef.current) {
      // Something new arrived since the last check. The full list reloads when the bell opens.
      listLoadedRef.current = false;
      setListLoaded(false);
      toast('You have new notifications', { duration: 4000 });
      if (soundEnabledRef.current) playChime();
    }
    countKnownRef.current = true;
    countReceivedAtRef.current = Date.now();
    unreadCountRef.current = next;
    setUnreadCount(next);
  }, []);

  // Light fetch for the badge: runs on every page load, so it asks for the count only
  // (one cheap query) instead of the 50-row list.
  // Only called with a signed-in user (see the effect below)
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?countOnly=1');
      if (!res.ok) return;
      const data = await res.json();
      applyUnreadCount(data.unreadCount || 0);
    } catch (err) {
      console.error('[useNotifications] unread count fetch error:', err);
    }
  }, [applyUnreadCount]);

  // Load the list the first time the bell is opened
  const loadNotifications = useCallback(async () => {
    if (listLoadedRef.current) return;
    await fetchNotifications();
  }, [fetchNotifications]);

  // Mark a single notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    if (!userId) return;
    
    setNotifications(prev => 
      prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));

    try {
      const csrfHeaders = await getCSRFHeaders();
      const res = await fetch('/api/notifications', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders
        },
        body: JSON.stringify({ notificationId })
      });

      if (!res.ok) throw new Error('Failed to mark notification as read');
    } catch (err) {
      console.error('Mark read error:', err);
      fetchNotifications();
    }
  }, [userId, fetchNotifications]);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    if (!userId) return;

    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);

    try {
      const csrfHeaders = await getCSRFHeaders();
      const res = await fetch('/api/notifications', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders
        },
        body: JSON.stringify({ all: true })
      });

      if (!res.ok) throw new Error('Failed to mark all as read');
    } catch (err) {
      console.error('Mark all read error:', err);
      fetchNotifications();
    }
  }, [userId, fetchNotifications]);

  // Delete a single notification
  const deleteNotification = useCallback(async (notificationId: string) => {
    if (!userId) return;
    
    const target = notificationsRef.current.find(n => n.id === notificationId);
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
    if (target && !target.read) {
      setUnreadCount(prev => Math.max(0, prev - 1));
    }

    try {
      const csrfHeaders = await getCSRFHeaders();
      const res = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders
        },
        body: JSON.stringify({ notificationId })
      });

      if (!res.ok) throw new Error('Failed to delete notification');
    } catch (err) {
      console.error('Delete notification error:', err);
      fetchNotifications();
    }
  }, [userId, fetchNotifications]);

  // Subscribe user to Web Push
  const subscribeToPush = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Web push notifications not supported.');
      return false;
    }
    if (!userId) return false;
    if (!VAPID_PUBLIC_KEY) {
      console.error('VAPID public key is missing.');
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      
      if (permission !== 'granted') {
        console.warn('Notification permission denied by user.');
        return false;
      }

      const subscribeOptions = {
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      };

      const subscription = await registration.pushManager.subscribe(subscribeOptions);

      const csrfHeaders = await getCSRFHeaders();
      const res = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders
        },
        body: JSON.stringify({ subscription })
      });

      if (!res.ok) {
        throw new Error('Failed to persist push subscription on server');
      }

      setPushSubscribed(true);
      return true;
    } catch (err) {
      console.error('Error subscribing to push:', err);
      return false;
    }
  }, [userId]);

  // Unsubscribe user from Web Push
  const unsubscribeFromPush = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return false;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const csrfHeaders = await getCSRFHeaders();
        const res = await fetch('/api/notifications/subscribe', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...csrfHeaders
          },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });

        await subscription.unsubscribe();
        setPushSubscribed(false);
        return res.ok;
      }
      return true;
    } catch (err) {
      console.error('Error unsubscribing from push:', err);
      return false;
    }
  }, []);

  // On load / login fetch only the unread count for the badge; the list loads when the bell opens.
  useEffect(() => {
    listLoadedRef.current = false;
    setListLoaded(false);
    countKnownRef.current = false;
    if (userId) {
      fetchUnreadCount();
    } else {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [userId, fetchUnreadCount]);

  // Check support, register service worker, check subscription status, and handle permissions
  useEffect(() => {
    const initPush = async () => {
      const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
      setPushSupported(isSupported);
      setPermissionState(Notification.permission);

      if (isSupported && userId) {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js');
          const subscription = await registration.pushManager.getSubscription();
          setPushSubscribed(!!subscription);

          // If the user already granted permission but doesn't have an active subscription, subscribe them
          if (Notification.permission === 'granted' && !subscription) {
            await subscribeToPush();
          }
        } catch (e) {
          console.error('Error initializing web push subscription:', e);
        }
      }
    };

    initPush();
  }, [userId, subscribeToPush]);

  // Safety-net poll of the badge count: 5 min + 0-1 min jitter, paused while the tab is hidden,
  // and skipped when the quiz page delivered a count recently
  const pollUnreadCount = useCallback(async (): Promise<boolean> => {
    if (!userId) return true;
    if (Date.now() - countReceivedAtRef.current < RECENT_COUNT_MS) return true;
    try {
      const res = await fetch('/api/notifications?countOnly=1');
      if (!res.ok) return false;
      const data = await res.json();
      applyUnreadCount(data.unreadCount || 0);
      return true;
    } catch {
      return false;
    }
  }, [userId, applyUnreadCount]);
  useJitteredPolling(pollUnreadCount, { intervalMs: UNREAD_POLL_MS, jitterMs: 60_000, enabled: !!userId });

  // On the quiz page, the personal list carries the count: no request of our own
  useEffect(() => {
    if (!userId) return;
    const onCount = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (typeof next === 'number') applyUnreadCount(next);
    };
    window.addEventListener(UNREAD_COUNT_EVENT, onCount);
    return () => window.removeEventListener(UNREAD_COUNT_EVENT, onCount);
  }, [userId, applyUnreadCount]);

  // The stream just showed a quiz pushed live or announced. The server stored that notification for
  // every player, so count it now instead of at the next poll, and reload the list on the next open.
  // No toast or chime: the stream's pop-up already announced it. The next real count replaces this.
  useEffect(() => {
    if (!userId) return;
    const onNotice = () => {
      unreadCountRef.current += 1;
      setUnreadCount(unreadCountRef.current);
      listLoadedRef.current = false;
      setListLoaded(false);
    };
    window.addEventListener(NEW_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(NEW_NOTICE_EVENT, onNotice);
  }, [userId]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    soundEnabled,
    toggleSound,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refresh: fetchNotifications,
    loadNotifications,
    listLoaded,
    pushSupported,
    pushSubscribed,
    permissionState,
    subscribeToPush,
    unsubscribeFromPush
  };
}

