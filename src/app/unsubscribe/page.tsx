import type { Metadata } from 'next';
import Link from 'next/link';
import { verifyUnsubscribeToken } from '@/lib/newsletter-unsubscribe';
import UnsubscribeButton from './UnsubscribeButton';

export const metadata: Metadata = {
  title: 'Unsubscribe | 1Think 2Win',
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string }>;
}) {
  const { e = '', t = '' } = await searchParams;
  let isValid = false;
  try {
    isValid = verifyUnsubscribeToken(e, t);
  } catch (error) {
    console.error('Unsubscribe token check failed:', error);
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-xl backdrop-blur">
        <h1 className="text-2xl font-bold text-white mb-3">Newsletter subscription</h1>
        {isValid ? (
          <>
            <p className="text-gray-300 mb-6">
              Stop sending newsletter emails to <span className="font-semibold text-white break-all">{e}</span>?
            </p>
            <UnsubscribeButton email={e} token={t} />
          </>
        ) : (
          <p className="text-gray-300">
            This unsubscribe link is invalid or incomplete. Please use the link from your latest newsletter email,
            or contact <a href="mailto:support@1think2win.com" className="text-blue-400 underline">support@1think2win.com</a>.
          </p>
        )}
        <Link href="/" className="inline-block mt-8 text-sm text-gray-400 hover:text-white">
          Back to 1Think 2Win
        </Link>
      </div>
    </div>
  );
}
