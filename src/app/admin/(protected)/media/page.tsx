import { Metadata } from 'next';
import MediaDashboard from './MediaDashboard';

export const metadata: Metadata = {
  title: 'Media Management | Admin Dashboard',
  description: 'Manage Cloudinary assets and storage',
};

export default function MediaPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <MediaDashboard />
    </div>
  );
}
