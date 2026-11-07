'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Check,
  Clock,
  Copy,
  FileText,
  Gift,
  HelpCircle,
  Mail,
  MessageCircle,
  ShieldCheck,
  Trophy,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { CONTACT_EMAIL, CONTACT_MAILTO } from '@/lib/site-contact';
import { useWalletEnabled } from '@/hooks/useWalletEnabled';
import { openChatbot } from '@/components/chatbot/open-chatbot';

interface Topic {
  id: string;
  title: string;
  icon: LucideIcon;
  /** What to put in the email so we can answer in one reply */
  include: string;
  subject: string;
  /** Only while the wallet is switched on */
  walletOnly?: boolean;
}

const TOPICS: Topic[] = [
  {
    id: 'account',
    title: 'Account & sign-in',
    icon: UserRound,
    include: 'The email address or phone number you signed up with, and what happens when you try to sign in.',
    subject: 'Account help',
  },
  {
    id: 'quizzes',
    title: 'Quizzes & points',
    icon: Trophy,
    include: 'The quiz name, roughly when you played it, and what you expected to see.',
    subject: 'Quiz question',
  },
  {
    id: 'prizes',
    title: 'Prizes & delivery',
    icon: Gift,
    include: 'The prize, the quiz you won it in (if any) and your WhatsApp number.',
    subject: 'Prize claim',
  },
  {
    id: 'wallet',
    title: 'Wallet & deposits',
    icon: Wallet,
    include: 'The transaction ID (TID), the amount, the date and the Easypaisa or JazzCash number you paid from.',
    subject: 'Wallet deposit',
    walletOnly: true,
  },
];

const LINKS = [
  { href: '/how-to-play', label: 'How to Play', icon: BookOpen },
  { href: '/faq', label: 'FAQ', icon: HelpCircle },
  { href: '/terms', label: 'Terms', icon: FileText },
  { href: '/privacy', label: 'Privacy', icon: ShieldCheck },
];

const mailtoWithSubject = (subject: string) => `${CONTACT_MAILTO}?subject=${encodeURIComponent(`[1Think 2Win] ${subject}`)}`;

export default function ContactContent() {
  const walletEnabled = useWalletEnabled();
  const [copied, setCopied] = useState(false);
  const topics = TOPICS.filter((topic) => !topic.walletOnly || walletEnabled === true);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (http, old browser): the address is on screen to copy by hand
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -right-32 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-blue-500/15 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-5xl">
        {/* Header */}
        <header className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-300">
            <Mail className="h-4 w-4" aria-hidden="true" />
            We reply within 24 hours
          </span>
          <h1 className="mt-5 font-[family-name:var(--font-poppins)] text-4xl font-extrabold text-white sm:text-5xl">
            Contact <span className="text-emerald-400">Us</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
            Questions about your account, a quiz, a prize{walletEnabled ? ' or a deposit' : ''}? Write to us and a real person
            from the 1Think 2Win team will get back to you.
          </p>
        </header>

        {/* Ways to reach us */}
        <div className="mt-10 grid grid-cols-1 gap-5 sm:mt-12 lg:grid-cols-5">
          <section aria-labelledby="contact-email" className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-6 sm:p-8 lg:col-span-3">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-300">
                <Mail className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 id="contact-email" className="text-xl font-bold text-white">Email us</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Our official inbox for support, prize claims, feedback and legal or privacy requests.
            </p>
            <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/70 p-2 pl-4">
              <a href={CONTACT_MAILTO} className="min-w-0 flex-1 break-all text-base font-semibold text-white hover:text-emerald-300 sm:text-lg">
                {CONTACT_EMAIL}
              </a>
              <button
                type="button"
                onClick={copyEmail}
                aria-label={copied ? 'Email address copied' : 'Copy email address'}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white/5 px-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <a
              href={mailtoWithSubject('Support request')}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-6 font-semibold text-white shadow-lg shadow-emerald-500/20 transition-shadow hover:shadow-emerald-500/40"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              Send an email
            </a>
            <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Every day, including weekends. Replies within 24 hours (PKT).
            </p>
          </section>

          <section aria-labelledby="contact-chat" className="flex flex-col rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-6 sm:p-8 lg:col-span-2">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-500/15 text-blue-300">
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 id="contact-chat" className="text-xl font-bold text-white">Ask the assistant</h2>
            </div>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-400">
              Get an instant answer about quizzes, points and prizes. Signed in? The assistant can also send your problem to
              our team as a support ticket, and tell you its status later.
            </p>
            <button
              type="button"
              onClick={openChatbot}
              className="mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Open the chat
            </button>
          </section>
        </div>

        {/* What to include */}
        <section aria-labelledby="contact-topics" className="mt-12 sm:mt-16">
          <h2 id="contact-topics" className="text-center text-2xl font-bold text-white sm:text-3xl">
            Get an answer in <span className="text-emerald-400">one reply</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-slate-400 sm:text-base">
            Pick your topic: the email opens with the subject filled in. Adding these details saves a round trip.
          </p>
          <div className={`mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 ${topics.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
            {topics.map(({ id, title, icon: Icon, include, subject }) => (
              <a
                key={id}
                href={mailtoWithSubject(subject)}
                className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-emerald-500/40 hover:bg-white/[0.06]"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-emerald-300 transition-transform group-hover:scale-110">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-semibold text-white">{title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">{include}</p>
                <span className="mt-4 text-sm font-medium text-emerald-400 group-hover:text-emerald-300">Email about this →</span>
              </a>
            ))}
          </div>
        </section>

        {/* Quick links */}
        <nav aria-label="Help pages" className="mt-12 grid grid-cols-2 gap-3 sm:mt-16 sm:grid-cols-4">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-white transition-colors hover:bg-white/[0.07]"
            >
              <Icon className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
