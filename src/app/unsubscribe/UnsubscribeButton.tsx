'use client';

import { useState } from 'react';

export default function UnsubscribeButton({ email, token }: { email: string; token: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const unsubscribe = async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ e: email, t: token }),
      });
      const data = await res.json().catch(() => ({}));
      setStatus(res.ok && data.success ? 'done' : 'error');
      setMessage(data.message || (res.ok ? '' : 'Something went wrong. Please try again.'));
    } catch {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  };

  if (status === 'done') {
    return <p className="text-emerald-400 font-medium">{message || 'You have been unsubscribed.'}</p>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={unsubscribe}
        disabled={status === 'loading'}
        className="w-full rounded-xl bg-red-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-60"
      >
        {status === 'loading' ? 'Unsubscribing…' : 'Unsubscribe'}
      </button>
      {status === 'error' && <p className="mt-3 text-sm text-red-400">{message}</p>}
    </div>
  );
}
