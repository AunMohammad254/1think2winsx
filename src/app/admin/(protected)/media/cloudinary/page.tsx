import { Metadata } from 'next';
import MediaNav from '../MediaNav';
import MediaDashboard from '../MediaDashboard';

export const metadata: Metadata = {
  title: 'Cloudinary Media | Admin Dashboard',
  description: 'Older images still served from Cloudinary',
};

export default function CloudinaryMediaPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <MediaNav active="cloudinary" />
      <MediaDashboard />
    </div>
  );
}
