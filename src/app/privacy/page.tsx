'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function PrivacyPolicy() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-blue-black relative overflow-hidden">
      {/* Optimized Background - Simplified for mobile */}
      {!isMobile && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Reduced number of animated elements for better performance */}
          <div className="absolute top-20 left-10 w-32 h-32 bg-blue-500/10 rounded-full animate-pulse will-change-opacity"></div>
          <div className="absolute top-40 right-20 w-24 h-24 bg-purple-500/10 rounded-full animate-pulse will-change-opacity" style={{animationDelay: '1s'}}></div>
          <div className="absolute bottom-32 left-1/4 w-28 h-28 bg-indigo-500/10 rounded-full animate-pulse will-change-opacity" style={{animationDelay: '2s'}}></div>
        </div>
      )}

      {/* Mobile-optimized static background */}
      {isMobile && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-20 left-10 w-16 h-16 bg-blue-500/5 rounded-full"></div>
          <div className="absolute bottom-32 right-10 w-20 h-20 bg-purple-500/5 rounded-full"></div>
        </div>
      )}

      <div className="relative z-10 container mx-auto px-4 py-8 max-w-4xl">
        {/* Header - Mobile-first responsive */}
        <div className="text-center mb-8 sm:mb-12">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 will-change-auto">
            Privacy Policy
          </h1>
          <p className="text-gray-300 text-sm sm:text-base">
            Last updated: December 2024
          </p>
        </div>

        {/* Content - Optimized glass cards */}
        <div className="space-y-6 sm:space-y-8">
          {/* Information Collection */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Information We Collect</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>We collect information you provide directly to us, such as when you:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Create an account or profile</li>
                <li>Participate in quizzes or games</li>
                <li>Contact us for support</li>
                <li>Subscribe to our newsletter</li>
              </ul>
            </div>
          </section>

          {/* How We Use Information */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">How We Use Your Information</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>We use the information we collect to:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Provide, maintain, and improve our services</li>
                <li>Process transactions and send related information</li>
                <li>Send you technical notices and support messages</li>
                <li>Communicate with you about products, services, and events</li>
              </ul>
            </div>
          </section>

          {/* Information Sharing */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Information Sharing</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>We do not sell, trade, or otherwise transfer your personal information to third parties except as described in this policy:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>With your consent</li>
                <li>To comply with legal obligations</li>
                <li>To protect our rights and safety</li>
                <li>With service providers who assist our operations</li>
              </ul>
            </div>
          </section>

          {/* Data Security */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Data Security</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>We implement appropriate security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.</p>
              <p>However, no method of transmission over the Internet or electronic storage is 100% secure, so we cannot guarantee absolute security.</p>
            </div>
          </section>

          {/* Data Retention */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Data Retention</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>We retain your personal information for as long as necessary to provide our services and fulfill the purposes outlined in this policy.</p>
              <p>We may also retain and use your information to comply with legal obligations, resolve disputes, and enforce our agreements.</p>
            </div>
          </section>

          {/* Your Rights */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Your Rights</h2>
            <div className="text-gray-300 space-y-4 text-sm sm:text-base leading-relaxed">
              <p>Depending on your location, you may have the following rights:</p>
              
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="glass-card-blue rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-blue-300 mb-2">Access</h3>
                  <p className="text-sm">Request access to your personal information</p>
                </div>
                <div className="glass-card-blue rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-blue-300 mb-2">Correction</h3>
                  <p className="text-sm">Request correction of inaccurate information</p>
                </div>
                <div className="glass-card-blue rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-blue-300 mb-2">Deletion</h3>
                  <p className="text-sm">Request deletion of your personal information</p>
                </div>
                <div className="glass-card-blue rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-blue-300 mb-2">Portability</h3>
                  <p className="text-sm">Request transfer of your information</p>
                </div>
              </div>
            </div>
          </section>

          {/* Cookies and Tracking */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Cookies and Tracking</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>We use cookies and similar tracking technologies to enhance your experience on our platform.</p>
              <p>You can control cookie settings through your browser preferences, though some features may not function properly if cookies are disabled.</p>
            </div>
          </section>

          {/* Children's Privacy */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Children&apos;s Privacy</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>Our services are not intended for children under 13 years of age.</p>
              <p>We do not knowingly collect personal information from children under 13. If we become aware that we have collected such information, we will take steps to delete it.</p>
            </div>
          </section>

          {/* Changes to Privacy Policy */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Changes to This Privacy Policy</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.</p>
              <p>Changes are effective immediately upon posting on our website.</p>
            </div>
          </section>

          {/* Contact Information */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Contact Us</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>If you have any questions about this Privacy Policy, please contact us:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Email: privacy@1think2win.com</li>
                <li>Phone: +1 (555) 123-4567</li>
                <li>Address: 123 Quiz Street, Game City, GC 12345</li>
              </ul>
            </div>
          </section>
        </div>

        {/* Footer - Mobile-optimized */}
        <footer className="mt-12 pt-8 border-t border-white/20">
          <div className="flex flex-col sm:flex-row justify-center items-center space-y-4 sm:space-y-0 sm:space-x-8">
            <Link 
              href="/terms" 
              className="text-blue-400 hover:text-blue-300 transition-colors duration-200 text-sm sm:text-base touch-target"
            >
              Terms of Service
            </Link>
            <Link 
              href="/contact" 
              className="text-blue-400 hover:text-blue-300 transition-colors duration-200 text-sm sm:text-base touch-target"
            >
              Contact Us
            </Link>
            <Link 
              href="/" 
              className="text-blue-400 hover:text-blue-300 transition-colors duration-200 text-sm sm:text-base touch-target"
            >
              Home
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}