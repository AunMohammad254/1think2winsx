'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ChevronLeft,
  Send,
  Bell,
  Trash2,
  Users,
  User,
  RefreshCw,
  Clock,
  Video,
  Hourglass,
  Zap,
  Info,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getCSRFHeaders } from '@/lib/csrf';

// Type definitions matching the schema
interface DBNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link: string | null;
  createdAt: string;
  User?: {
    name: string | null;
    email: string;
  } | null;
}

type NotificationType = 'live_stream' | 'quiz_deadline' | 'streak_reminder' | 'general';
type TargetType = 'broadcast' | 'user';

const typeConfig: Record<string, { label: string; icon: any; color: string; bgColor: string }> = {
  live_stream: { label: 'Live Stream', icon: Video, color: 'text-pink-400', bgColor: 'bg-pink-500/10 border-pink-500/20' },
  quiz_deadline: { label: 'Quiz / Deadline', icon: Hourglass, color: 'text-blue-400', bgColor: 'bg-blue-500/10 border-blue-500/20' },
  streak_reminder: { label: 'Streak / Activity', icon: Zap, color: 'text-amber-400', bgColor: 'bg-amber-500/10 border-amber-500/20' },
  general: { label: 'General / Alert', icon: Info, color: 'text-purple-400', bgColor: 'bg-purple-500/10 border-purple-500/20' },
};

export default function AdminNotificationPage() {
  // Form State
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<NotificationType>('general');
  const [link, setLink] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('broadcast');
  const [targetEmail, setTargetEmail] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  
  // UI State
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  
  // History State
  const [history, setHistory] = useState<DBNotification[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Fetch recent notifications triggered via the API history endpoint
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/admin/notifications?limit=50&offset=0');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to load history');
      }
      
      setHistory(data.notifications || []);
    } catch (err) {
      console.error('Failed to fetch history:', err);
      toast.error('Failed to load notification history');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab, fetchHistory]);

  // Handle Form Submit
  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !message.trim()) {
      toast.error('Title and message are required');
      return;
    }

    if (targetType === 'user' && !targetEmail.trim()) {
      toast.error('Recipient email is required for user targeted notifications');
      return;
    }

    setLoading(true);
    try {
      const csrfHeaders = await getCSRFHeaders();
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders
        },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          type,
          link: link.trim() || undefined,
          targetType,
          targetEmail: targetType === 'user' ? targetEmail.trim().toLowerCase() : undefined,
          scheduledAt: scheduledAt || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to send notification');
      }

      toast.success(data.message || 'Notification processed successfully');
      
      // Clear form inputs
      setTitle('');
      setMessage('');
      setLink('');
      setTargetEmail('');
      setScheduledAt('');
      
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  // Delete notification
  const handleDeleteNotification = async (id: string) => {
    if (!confirm('Are you sure you want to delete this notification record?')) return;

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('Notification')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Notification deleted');
      setHistory(prev => prev.filter(n => n.id !== id));
    } catch (err) {
      console.error('Delete notification failed:', err);
      toast.error('Failed to delete notification');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link
                href="/admin/dashboard"
                className="text-gray-400 hover:text-white transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-3xl font-bold text-white flex items-center gap-2.5">
                <Bell className="w-7 h-7 text-purple-400" />
                Notification Manager
              </h1>
            </div>
            <p className="text-gray-400">Broadcast updates to all users or target specific players with alerts</p>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-white/10 mb-8">
          <button
            onClick={() => setActiveTab('create')}
            className={`px-5 py-3 text-sm font-semibold transition-all border-b-2 -mb-[2px] ${
              activeTab === 'create'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Create Notification
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-5 py-3 text-sm font-semibold transition-all border-b-2 -mb-[2px] ${
              activeTab === 'history'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Notification History
          </button>
        </div>

        {/* Create Notification Tab */}
        {activeTab === 'create' && (
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-6">Send New Notification</h2>
            
            <form onSubmit={handleSendNotification} className="space-y-5">
              
              {/* Target Type Selector */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                  Recipient Target
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTargetType('broadcast')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all ${
                      targetType === 'broadcast'
                        ? 'bg-purple-600/10 border-purple-500 text-purple-300 shadow-md shadow-purple-500/5'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>Broadcast (All Users)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetType('user')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all ${
                      targetType === 'user'
                        ? 'bg-purple-600/10 border-purple-500 text-purple-300 shadow-md shadow-purple-500/5'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <User className="w-4 h-4" />
                    <span>Target Single User</span>
                  </button>
                </div>
              </div>

              {/* Single User Target Input */}
              {targetType === 'user' && (
                <div className="animate-fadeIn">
                  <label htmlFor="targetEmail" className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    User Email Address
                  </label>
                  <input
                    id="targetEmail"
                    type="email"
                    placeholder="player@example.com"
                    value={targetEmail}
                    onChange={(e) => setTargetEmail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors text-sm"
                    required={targetType === 'user'}
                  />
                </div>
              )}

              {/* Notification Type */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                  Notification Type / Category
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.keys(typeConfig) as NotificationType[]).map((cat) => {
                    const cfg = typeConfig[cat];
                    const Icon = cfg.icon;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setType(cat)}
                        className={`flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border text-xs font-medium transition-all ${
                          type === cat
                            ? 'bg-purple-600/10 border-purple-500 text-purple-300'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                        }`}
                      >
                        <div className={`p-1.5 rounded-lg ${cfg.bgColor}`}>
                          <Icon className={`w-4 h-4 ${cfg.color}`} />
                        </div>
                        <span>{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-white/5 my-4" />

              {/* Title */}
              <div>
                <label htmlFor="title" className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Notification Title
                </label>
                <input
                  id="title"
                  type="text"
                  placeholder="e.g. Live Stream Starting Now!"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors text-sm font-medium"
                  required
                />
              </div>

              {/* Message */}
              <div>
                <label htmlFor="message" className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Message Content
                </label>
                <textarea
                  id="message"
                  placeholder="Draft the alert details here..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2.5 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors text-sm"
                  required
                />
              </div>

              {/* Link */}
              <div>
                <label htmlFor="link" className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Action Link / Redirect Path (Optional)
                </label>
                <input
                  id="link"
                  type="text"
                  placeholder="e.g. /quizzes or /prizes"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors text-sm"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Users clicking the notification will be automatically redirected to this internal pathname.
                </p>
              </div>

              {/* Schedule Delivery */}
              <div>
                <label htmlFor="scheduledAt" className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Schedule Delivery (Optional)
                </label>
                <input
                  id="scheduledAt"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors text-sm"
                  min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Leave blank to send immediately. If specified, the notification will be processed by the background cron.
                </p>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Dispatching...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Send Notification</span>
                  </>
                )}
              </button>

            </form>
          </div>
        )}

        {/* History Log Tab */}
        {activeTab === 'history' && (
          <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
            
            {/* Header / Filter */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
              <h2 className="text-sm font-semibold text-white">Sent Notifications Log</h2>
              <button
                onClick={fetchHistory}
                disabled={historyLoading}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* List */}
            <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto custom-scrollbar">
              {historyLoading && history.length === 0 ? (
                <div className="flex justify-center items-center py-12 text-gray-500 text-sm">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                  <span>Loading history...</span>
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <AlertCircle className="w-10 h-10 text-gray-600 mb-3" />
                  <p className="text-sm text-white/80 font-medium">No sent notifications found</p>
                  <p className="text-xs text-white/40 mt-1">Notifications dispatched will show up here.</p>
                </div>
              ) : (
                history.map((notif) => {
                  const cfg = typeConfig[notif.type] || typeConfig.general;
                  const Icon = cfg.icon;

                  return (
                    <div
                      key={notif.id}
                      className="flex gap-4 p-4 hover:bg-white/[0.02] transition-colors items-start"
                    >
                      {/* Icon */}
                      <div className={`flex items-center justify-center w-9 h-9 rounded-xl border shrink-0 ${cfg.bgColor}`}>
                        <Icon className={`w-4.5 h-4.5 ${cfg.color}`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                          <h3 className="text-sm font-semibold text-white truncate">{notif.title}</h3>
                          <span className="text-[10px] text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(notif.createdAt).toLocaleString()}
                          </span>
                        </div>
                        
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">{notif.message}</p>
                        
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2.5 text-[10px] text-gray-500">
                          {/* Target user information */}
                          <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-white/60">
                            Recipient: {notif.User ? notif.User.email : 'Global Broadcast'}
                          </span>
                          
                          {notif.link && (
                            <span className="underline">Link: {notif.link}</span>
                          )}

                          {notif.User && (
                            <span className="flex items-center gap-1">
                              Status: {notif.read ? (
                                <span className="text-green-400 flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" /> Read</span>
                              ) : (
                                <span className="text-gray-400">Unread</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action */}
                      <button
                        onClick={() => handleDeleteNotification(notif.id)}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors self-center"
                        title="Delete notification"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            
          </div>
        )}

      </div>
    </div>
  );
}
