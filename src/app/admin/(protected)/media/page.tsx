import { Metadata } from 'next';
import MediaNav from './MediaNav';
import SiteMediaManager from './SiteMediaManager';

export const metadata: Metadata = {
  title: 'Media Management | Admin Dashboard',
  description: 'Manage site and prize images in Supabase Storage',
};

export default function MediaPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <MediaNav active="site" />
      <SiteMediaManager />
    </div>
  );
}
