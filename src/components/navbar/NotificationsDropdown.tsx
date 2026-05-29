'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Volume2, VolumeX, Video, Hourglass, Zap, Info, Check, CheckCheck, Trash2 } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';

// Icon and color map based on notification types
const notificationTypeConfig: Record<string, { icon: any; iconColor: string; bgColor: string }> = {
  live_stream: {
    icon: Video,
    iconColor: 'text-pink-400',
    bgColor: 'bg-pink-500/10 border-pink-500/20',
  },
  quiz_deadline: {
    icon: Hourglass,
    iconColor: 'text-blue-400',
    bgColor: 'bg-blue-500/10 border-blue-500/20',
  },
  streak_reminder: {
    icon: Zap,
    iconColor: 'text-amber-400',
    bgColor: 'bg-amber-500/10 border-amber-500/20',
  },
  general: {
    icon: Info,
    iconColor: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/20',
  },
};

export default function NotificationsDropdown() {
  const {
    notifications,
    unreadCount,
    loading,
    soundEnabled,
    toggleSound,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const formatRelativeTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      markAsRead(notification.id);
    }
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      {/* Bell Trigger Button */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex items-center justify-center p-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 text-white/80" />
        
        {/* Animated Badge Counter */}
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-[10px] font-bold text-white shadow-lg shadow-pink-500/20 border border-black"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Dropdown Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-full mt-2 w-80 md:w-96 origin-top-right z-[1000]"
          >
            <div className="rounded-2xl bg-gray-950/95 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 overflow-hidden">
              
              {/* Dropdown Header */}
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10 bg-white/5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">Notifications</h3>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-medium border border-purple-500/30">
                      {unreadCount} new
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {/* Sound Toggle */}
                  <button
                    onClick={() => toggleSound(!soundEnabled)}
                    className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-colors"
                    title={soundEnabled ? 'Mute sound' : 'Unmute sound'}
                  >
                    {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </button>

                  {/* Mark All As Read */}
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 transition-colors"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>Read all</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Notifications List */}
              <div className="max-h-96 overflow-y-auto divide-y divide-white/5 custom-scrollbar">
                {loading ? (
                  <div className="flex items-center justify-center py-10 text-gray-500 text-sm">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-purple-500 border-t-transparent mr-2" />
                    <span>Loading notifications...</span>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div className="p-3 rounded-full bg-white/5 border border-white/5 text-gray-500 mb-3">
                      <Bell className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-medium text-white/80">All caught up!</p>
                    <p className="text-xs text-white/40 mt-1">No notifications at the moment.</p>
                  </div>
                ) : (
                  notifications.map((notif) => {
                    const typeConfig = notificationTypeConfig[notif.type] || notificationTypeConfig.general;
                    const TypeIcon = typeConfig.icon;

                    return (
                      <div
                        key={notif.id}
                        className={`relative flex gap-3 p-4 transition-colors hover:bg-white/5 ${
                          !notif.read ? 'bg-purple-500/[0.02]' : ''
                        }`}
                      >
                        {/* Unread Status Dot Indicator */}
                        {!notif.read && (
                          <span className="absolute top-4 right-4 flex h-2 w-2 rounded-full bg-blue-500" />
                        )}

                        {/* Icon Wrapper */}
                        <div className={`flex items-center justify-center w-9 h-9 rounded-xl border shrink-0 ${typeConfig.bgColor}`}>
                          <TypeIcon className={`w-4.5 h-4.5 ${typeConfig.iconColor}`} />
                        </div>

                        {/* Text Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-white truncate pr-2">
                              {notif.title}
                            </p>
                            <span className="text-[10px] text-white/40 whitespace-nowrap shrink-0 pt-0.5">
                              {formatRelativeTime(notif.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-white/60 mt-1 leading-relaxed break-words">
                            {notif.message}
                          </p>

                          {/* Link Redirection or Mark Read Button and Delete */}
                          <div className="flex items-center justify-between mt-2.5">
                            <div className="flex items-center gap-3">
                              {notif.link ? (
                                <Link
                                  href={notif.link}
                                  onClick={() => handleNotificationClick(notif)}
                                  className="text-[10px] font-semibold text-purple-400 hover:text-purple-300 hover:underline"
                                >
                                  View Details →
                                </Link>
                              ) : (
                                !notif.read && (
                                  <button
                                    onClick={() => markAsRead(notif.id)}
                                    className="flex items-center gap-1 text-[10px] font-semibold text-white/40 hover:text-white transition-colors"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>Mark as read</span>
                                  </button>
                                )
                              )}
                            </div>
                            <button
                              onClick={() => deleteNotification(notif.id)}
                              className="text-white/40 hover:text-red-400 p-1 rounded hover:bg-white/5 transition-colors"
                              title="Delete notification"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
