import Link from 'next/link';

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
      <h1 className="text-2xl font-bold text-white">Media Management</h1>
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
