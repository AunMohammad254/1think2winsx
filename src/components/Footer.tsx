'use client';

import Link from 'next/link';
import { memo, useState } from 'react';
import { toast } from 'sonner';
import { getCSRFHeaders } from '@/lib/csrf';
import { Reveal } from '@/components/landing/Primitives';

const quickLinks = [
  { href: '/', label: 'Home' },
  { href: '/quizzes', label: 'Quizzes' },
  { href: '/prizes', label: 'Prizes' },
  { href: '/leaderboard', label: 'Leaderboard' },
];

const supportLinks = [
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact Us' },
  { href: '/disclaimer', label: 'Disclaimer' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
];

const Footer = memo(function Footer() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error('Please enter your email address');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error('Please enter a valid email address');
      return;
    }
    setLoading(true);
    try {
      const csrfHeaders = await getCSRFHeaders();
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message || 'Subscribed successfully!');
        setEmail('');
      } else {
        toast.error(data.message || 'Failed to subscribe');
      }
    } catch {
      toast.error('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <footer className="relative overflow-hidden border-t border-white/5 bg-ink-950">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/4 h-80 w-80 rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute -bottom-40 right-1/4 h-80 w-80 rounded-full bg-amber-400/10 blur-[120px]" />
        <div className="absolute left-1/2 top-1/2 h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/10 blur-[100px]" />
      </div>
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-20" />

      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-12 lg:gap-12">
          {/* Brand */}
          <Reveal delay={0} className="sm:col-span-2 md:col-span-3 lg:col-span-4">
            <div className="glass relative overflow-hidden rounded-2xl p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-amber-400 text-xl shadow-lg">
                  🏏
                </span>
                <div>
                  <h3 className="font-display text-lg font-bold text-white">1Think 2Win</h3>
                  <p className="text-xs text-emerald-400/80">Think Smart, Win Big</p>
                </div>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-white/55">
                Test your cricket knowledge and win amazing prizes in our innovative quiz competition.
                Join thousands of smart thinkers in this exciting journey of knowledge and rewards!
              </p>
              <div className="mt-5 flex items-center gap-2 text-xs text-white/40">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
                <span>Trusted by <span className="font-semibold text-white/70">10,000+</span> players</span>
              </div>
            </div>
          </Reveal>

          {/* Quick Links */}
          <Reveal delay={100} className="sm:col-span-1 md:col-span-1.5 lg:col-span-2">
            <h4 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-[0.18em] text-emerald-400">
              <span>⚡</span> Quick Links
            </h4>
            <ul className="space-y-1.5">
              {quickLinks.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="group flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/55 transition-all duration-200 hover:bg-white/[0.04] hover:text-white"
                  >
                    <span className="text-[10px] text-white/20 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-400">▸</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>

          {/* Support */}
          <Reveal delay={200} className="sm:col-span-1 md:col-span-1.5 lg:col-span-2">
            <h4 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-[0.18em] text-emerald-400">
              <span>🛟</span> Support
            </h4>
            <ul className="space-y-1.5">
              {supportLinks.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="group flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/55 transition-all duration-200 hover:bg-white/[0.04] hover:text-white"
                  >
                    <span className="text-[10px] text-white/20 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-400">▸</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>

          {/* Contact */}
          <Reveal delay={300} className="sm:col-span-2 md:col-span-3 lg:col-span-4">
            <h4 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-[0.18em] text-emerald-400">
              <span>📞</span> Contact
            </h4>
            <div className="glass relative overflow-hidden rounded-2xl p-5">
              <div className="space-y-4">
                <a
                  href="mailto:support@1think2win.com"
                  className="group flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-white/[0.04]"
                >
                  <span className="mt-0.5 text-lg">✉️</span>
                  <div>
                    <p className="text-xs text-white/40">Email</p>
                    <p className="text-sm font-medium text-white transition-colors group-hover:text-emerald-400">support@1think2win.com</p>
                  </div>
                </a>
                <div className="flex items-start gap-3 rounded-lg p-2">
                  <span className="mt-0.5 text-lg">📱</span>
                  <div>
                    <p className="text-xs text-white/40">Phone</p>
                    <p className="text-sm font-medium text-white">+92 XXX XXXXXXX</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="mb-3 text-xs text-white/40">Follow Us</p>
                <div className="flex gap-2.5">
                  {[
                    { name: 'Facebook', icon: '📘', href: '#' },
                    { name: 'Twitter', icon: '🐦', href: '#' },
                    { name: 'Instagram', icon: '📸', href: '#' },
                  ].map((social) => (
                    <a
                      key={social.name}
                      href={social.href}
                      className="group grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-base transition-all duration-300 hover:scale-110 hover:border-emerald-400/30 hover:bg-emerald-500/10 hover:shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)]"
                      title={social.name}
                    >
                      {social.icon}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        {/* Newsletter */}
        <Reveal delay={400}>
          <div className="relative mt-12 overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.06] to-amber-400/[0.04] p-4 sm:p-6 md:p-8">
            <div className="pointer-events-none absolute -right-20 -top-20 h-40 w-40 rounded-full bg-emerald-500/20 blur-[80px]" />
            <div className="pointer-events-none absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-amber-400/20 blur-[80px]" />
            <div className="relative mx-auto max-w-lg text-center">
              <h3 className="flex items-center justify-center gap-2 font-display text-xl font-bold text-white">
                <span>🔔</span>
                <span>Stay Updated</span>
              </h3>
              <p className="mt-2 text-sm text-white/55">
                Get the latest quiz updates, cricket news, and exclusive prizes delivered to your inbox!
              </p>
              <form onSubmit={handleSubscribe} className="mt-6 flex flex-col gap-2 sm:gap-3 md:flex-row">
                <input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm sm:px-4 sm:py-2.5 text-white placeholder-white/40 outline-none transition-all duration-200 focus:border-emerald-400/40 focus:bg-white/[0.06] focus:ring-1 focus:ring-emerald-400/30 disabled:opacity-50 md:flex-1"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-shine group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 via-emerald-400 to-amber-400 px-4 py-2 text-sm font-semibold sm:px-6 sm:py-2.5 text-ink-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.6)] transition-all duration-300 hover:scale-[1.02] disabled:opacity-50 md:w-auto"
                >
                  {loading ? (
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-950 border-t-transparent" />
                  ) : (
                    <>
                      <span>Subscribe</span>
                      <span className="text-base transition-transform duration-300 group-hover:translate-x-0.5">→</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </Reveal>

        {/* Bottom Bar */}
        <Reveal delay={500}>
          <div className="mt-12 border-t border-white/10 pt-8">
            <div className="glass relative overflow-hidden rounded-2xl p-6">
              <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
                <div className="text-center md:text-left">
                  <p className="text-sm text-white/55">
                    &copy; 2025 <span className="font-semibold text-white">1Think 2Win</span>. All rights reserved.
                  </p>
                  <p className="mt-1 flex items-center justify-center gap-1 text-xs text-white/35 md:justify-start">
                    Crafted for cricket enthusiasts worldwide
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Live</span>
                  </div>
                  <span className="text-xs text-white/35">Made with passion</span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </footer>
  );
});

Footer.displayName = 'Footer';
export default Footer;
