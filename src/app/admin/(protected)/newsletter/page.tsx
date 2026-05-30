'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Mail,
  Send,
  Users,
  ChevronLeft,
  Search,
  Trash2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  FileText
} from 'lucide-react';
import { getCSRFHeaders } from '@/lib/csrf';

export default function AdminNewsletterPage() {
  // Subscribers state
  const [subscribers, setSubscribers] = useState<string[]>([]);
  const [loadingSubscribers, setLoadingSubscribers] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Dispatch Form state
  const [senderEmail, setSenderEmail] = useState('support@1think2win.com');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Fetch subscribers list
  const fetchSubscribers = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoadingSubscribers(true);
      const csrfHeaders = await getCSRFHeaders();
      const response = await fetch('/api/admin/newsletter/subscribers', {
        headers: {
          ...csrfHeaders
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          toast.error('Session expired. Please log in again.');
          return;
        }
        throw new Error('Failed to fetch subscribers');
      }

      const data = await response.json();
      setSubscribers(data.subscribers || []);
    } catch (error) {
      console.error('Error loading subscribers:', error);
      toast.error('Failed to load subscribers list');
    } finally {
      if (!silent) setLoadingSubscribers(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscribers();
  }, [fetchSubscribers]);

  // Handle subscriber deletion
  const handleDeleteSubscriber = async (email: string) => {
    if (!confirm(`Are you sure you want to remove ${email} from the newsletter?`)) {
      return;
    }

    try {
      const csrfHeaders = await getCSRFHeaders();
      const response = await fetch('/api/admin/newsletter/subscribers', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders
        },
        body: JSON.stringify({ email })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        toast.success('Subscriber successfully removed.');
        // Filter out from local state
        setSubscribers(prev => prev.filter(e => e !== email));
      } else {
        toast.error(data.message || 'Failed to remove subscriber');
      }
    } catch (error) {
      console.error('Error deleting subscriber:', error);
      toast.error('An error occurred. Please try again.');
    }
  };

  // Handle email dispatch
  const handleSendNewsletter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senderEmail || !subject || !content) {
      toast.error('All fields are required.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(senderEmail.trim())) {
      toast.error('Please enter a valid sender email.');
      return;
    }

    if (content.trim().length < 10) {
      toast.error('Newsletter description should be at least 10 characters.');
      return;
    }

    if (subscribers.length === 0) {
      toast.error('There are no subscribers to send emails to.');
      return;
    }

    if (!confirm(`Are you sure you want to send this email to all ${subscribers.length} subscriber(s)?`)) {
      return;
    }

    setSending(true);
    setSendSuccess(false);

    try {
      const csrfHeaders = await getCSRFHeaders();
      const response = await fetch('/api/admin/newsletter/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders
        },
        body: JSON.stringify({
          senderEmail: senderEmail.trim(),
          subject: subject.trim(),
          content: content.trim()
        })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        toast.success(data.message || 'Newsletter sent successfully!');
        setSubject('');
        setContent('');
        setSendSuccess(true);
      } else {
        toast.error(data.message || 'Failed to send newsletter');
      }
    } catch (error) {
      console.error('Newsletter dispatch error:', error);
      toast.error('An error occurred. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // Filter subscribers list
  const filteredSubscribers = subscribers.filter(email =>
    email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        
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
              <h1 className="text-3xl font-bold text-white">Newsletter Dispatch</h1>
            </div>
            <p className="text-gray-400">Send updates, news, and ads to all subscribed users</p>
          </div>

          <button
            onClick={() => fetchSubscribers()}
            disabled={loadingSubscribers}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loadingSubscribers ? 'animate-spin' : ''}`} />
            Refresh list
          </button>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{subscribers.length}</p>
              <p className="text-sm text-gray-400">Total Subscribed Users</p>
            </div>
          </div>

          <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Mail className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">Active</p>
              <p className="text-sm text-gray-400">Brevo Email Service</p>
            </div>
          </div>

          <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">BCC Mode</p>
              <p className="text-sm text-gray-400">Privacy Safeguarded</p>
            </div>
          </div>
        </div>

        {/* Form and List Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Dispatch Email Form Column */}
          <div className="lg:col-span-7 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Send className="w-5 h-5 text-blue-400" />
              Compose Newsletter
            </h2>

            {sendSuccess && (
              <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Newsletter Dispatched</p>
                  <p className="text-xs text-emerald-300/80">The email has been successfully queued and sent to all subscribers in the background.</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSendNewsletter} className="space-y-5">
              <div>
                <label htmlFor="sender" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Sender Email Address
                </label>
                <input
                  type="email"
                  id="sender"
                  required
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="e.g. support@1think2win.com"
                  className="w-full px-4 py-2.5 bg-gray-950/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
                />
                <p className="text-[11px] text-gray-500 mt-1">This email must be configured in your Brevo/sender domain setup.</p>
              </div>

              <div>
                <label htmlFor="subject" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Email Subject
                </label>
                <input
                  type="text"
                  id="subject"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Weekly Quiz Update & Cricket News"
                  className="w-full px-4 py-2.5 bg-gray-950/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
                />
              </div>

              <div>
                <label htmlFor="content" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Email Description / Content (HTML/Plain Text)
                </label>
                <textarea
                  id="content"
                  required
                  rows={10}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Type your newsletter body here... HTML markup is allowed."
                  className="w-full px-4 py-2.5 bg-gray-950/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors font-sans resize-y"
                />
              </div>

              <div className="flex items-center gap-3 p-3.5 bg-blue-500/5 border border-blue-500/10 rounded-xl text-blue-300/80 text-xs">
                <AlertCircle className="w-5 h-5 text-blue-400 shrink-0" />
                <p>Clicking dispatch will immediately send the mail to all active subscribers. Please verify the description and details before sending.</p>
              </div>

              <button
                type="submit"
                disabled={sending || subscribers.length === 0}
                className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Dispatching Newsletter...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Dispatch to {subscribers.length} Subscriber(s)
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Subscribers List Column */}
          <div className="lg:col-span-5 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-purple-400" />
              Subscribers list
            </h2>

            {/* Search */}
            <div className="relative mb-5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-500" />
              <input
                type="text"
                placeholder="Search email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-gray-950/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors text-sm"
              />
            </div>

            {/* List */}
            <div className="border border-white/10 rounded-xl overflow-hidden max-h-[500px] overflow-y-auto custom-scrollbar divide-y divide-white/5 bg-gray-950/30">
              {loadingSubscribers ? (
                <div className="py-12 text-center text-gray-500 flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="w-6 h-6 animate-spin text-purple-500" />
                  <p className="text-sm">Loading subscribers list...</p>
                </div>
              ) : filteredSubscribers.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  <Users className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                  <p className="text-sm font-medium">No subscribers found</p>
                  {searchQuery && <p className="text-xs text-gray-600 mt-1">Try another search query</p>}
                </div>
              ) : (
                filteredSubscribers.map((email) => (
                  <div key={email} className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors gap-3">
                    <span className="text-sm text-gray-300 truncate font-medium">{email}</span>
                    <button
                      onClick={() => handleDeleteSubscriber(email)}
                      className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors shrink-0"
                      title="Remove subscriber"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          
        </div>

      </div>
    </div>
  );
}
