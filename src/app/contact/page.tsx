import type { Metadata } from 'next';
import ContactContent from '@/components/contact/ContactContent';

export const metadata: Metadata = {
  title: 'Contact Us | 1Think 2Win',
  description: 'Email the 1Think 2Win team at 1think2wins@gmail.com or ask the chat assistant. We reply within 24 hours.',
};

export default function ContactPage() {
  return <ContactContent />;
}
