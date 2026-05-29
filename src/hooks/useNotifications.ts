'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { getCSRFHeaders } from '@/lib/csrf';
import { toast } from 'sonner';

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

// Function to play a premium chime sound synthesized on the fly via Web Audio API
export function playChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    
    const audioCtx = new AudioContextClass();
    
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      
      gainNode.gain.setValueAtTime(0.12, start);
      gainNode.gain.exponentialRampToValueAtTime(0.001, start + duration);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start(start);
      osc.stop(start + duration);
    };

    const now = audioCtx.currentTime;
    // Premium soft double chime sound: C5 followed shortly by E5
    playTone(523.25, now, 0.15); // C5
    playTone(659.25, now + 0.08, 0.25); // E5
  } catch (err) {
    console.error('AudioContext chime failed', err);
  }
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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Sound settings persistent in localStorage
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  // Web Push Subscription states
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default');

  // Ref to track sound setting inside real-time listener without re-binding channel
  const soundEnabledRef = useRef(soundEnabled);

  useEffect(() => {
    // Sync ref with state
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Load sound setting from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('notifications_sound_enabled');
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
      localStorage.setItem('notifications_sound_enabled', String(value));
    } catch (e) {
      console.warn('Could not save sound setting', e);
    }
  }, []);

  // Fetch initial notifications
  const fetchNotifications = useCallback(async () => {
    if (!user) return;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('[useNotifications] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Mark a single notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    if (!user) return;
    
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
  }, [user, fetchNotifications]);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    if (!user) return;

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
  }, [user, fetchNotifications]);

  // Delete a single notification
  const deleteNotification = useCallback(async (notificationId: string) => {
    if (!user) return;
    
    let wasUnread = false;
    setNotifications(prev => {
      const target = prev.find(n => n.id === notificationId);
      if (target && !target.read) {
        wasUnread = true;
      }
      return prev.filter(n => n.id !== notificationId);
    });
    
    if (wasUnread) {
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
  }, [user, fetchNotifications]);

  // Subscribe user to Web Push
  const subscribeToPush = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Web push notifications not supported.');
      return false;
    }
    if (!user) return false;
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
  }, [user]);

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

  // Fetch on load / login
  useEffect(() => {
    if (user) {
      fetchNotifications();
    } else {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [user, fetchNotifications]);

  // Check support, register service worker, check subscription status, and handle permissions
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initPush = async () => {
      const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
      setPushSupported(isSupported);
      setPermissionState(Notification.permission);

      if (isSupported && user) {
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
  }, [user, subscribeToPush]);

  // Real-time subscription to Notification insertions
  useEffect(() => {
    if (!user) return;

    const supabase = createClient();
    
    const channel = supabase
      .channel(`user-notifications-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'Notification',
        filter: `userId=eq.${user.id}`
      }, (payload) => {
        const newNotif = payload.new as Notification;
        
        toast(newNotif.title, {
          description: newNotif.message,
          action: newNotif.link ? {
            label: 'View',
            onClick: () => {
              window.location.href = newNotif.link!;
            }
          } : undefined,
          duration: 6000,
        });

        if (soundEnabledRef.current) {
          playChime();
        }

        setNotifications(prev => [newNotif, ...prev]);
        setUnreadCount(prev => prev + 1);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

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
    pushSupported,
    pushSubscribed,
    permissionState,
    subscribeToPush,
    unsubscribeFromPush
  };
}

