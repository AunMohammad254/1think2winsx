import { Metadata } from 'next';
import MediaNav from '../MediaNav';
import ProfilePicturesManager from './ProfilePicturesManager';

export const metadata: Metadata = {
  title: 'Player Profile Pictures | Admin Dashboard',
  description: 'Review and remove player profile pictures',
};

export default function ProfilePicturesPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <MediaNav active="profile-pictures" />
      <ProfilePicturesManager />
    </div>
  );
}
