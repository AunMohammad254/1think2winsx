import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

const TABS = [
  { key: 'site', href: '/admin/media', label: 'Site & prize images' },
  { key: 'profile-pictures', href: '/admin/media/profile-pictures', label: 'Player profile pictures' },
  { key: 'cloudinary', href: '/admin/media/cloudinary', label: 'Cloudinary (old uploads)' },
] as const;

export type MediaTab = (typeof TABS)[number]['key'];

/** Tabs shared by the media pages, so admin images and players' pictures stay on separate pages. */
export default function MediaNav({ active }: { active: MediaTab }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <Link
          href="/admin/dashboard"
          className="text-gray-400 hover:text-white transition-colors"
          title="Back to Dashboard"
          aria-label="Back to Dashboard"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Media Management</h1>
      </div>
      <p className="text-gray-400 text-sm mt-1">
        Images are stored in Supabase Storage, resized to WebP once when uploaded.
      </p>
      <nav aria-label="Media sections" className="mt-4 flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? 'page' : undefined}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab.key === active
                ? 'bg-blue-600 text-white'
                : 'bg-gray-900/60 text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
