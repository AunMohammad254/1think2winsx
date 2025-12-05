'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function TermsOfService() {
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
            Terms of Service
          </h1>
          <p className="text-gray-300 text-sm sm:text-base">
            Last updated: December 2024
          </p>
        </div>

        {/* Content - Optimized glass cards */}
        <div className="space-y-6 sm:space-y-8">
          {/* Acceptance of Terms */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Acceptance of Terms</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>By accessing and using our quiz platform, you accept and agree to be bound by the terms and provision of this agreement.</p>
              <p>If you do not agree to abide by the above, please do not use this service.</p>
            </div>
          </section>

          {/* Service Description */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Service Description</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>Our platform provides interactive quiz games where users can:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Participate in various quiz competitions</li>
                <li>Compete for prizes and rewards</li>
                <li>Track their performance and rankings</li>
                <li>Interact with other users</li>
              </ul>
            </div>
          </section>

          {/* User Accounts */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">User Accounts</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>To access certain features, you must create an account. You are responsible for:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Maintaining the confidentiality of your account information</li>
                <li>All activities that occur under your account</li>
                <li>Providing accurate and complete information</li>
                <li>Notifying us immediately of any unauthorized use</li>
              </ul>
            </div>
          </section>

          {/* Quiz Participation */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Quiz Participation and Payments</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>Some quizzes may require entry fees or payments. By participating, you agree that:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>All payments are final and non-refundable</li>
                <li>You meet the minimum age requirements</li>
                <li>You comply with all applicable laws</li>
                <li>You understand the rules and prize structure</li>
              </ul>
            </div>
          </section>

          {/* Prize Distribution */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Prize Distribution</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>Prizes will be distributed according to the specific rules of each quiz. General conditions include:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Winners will be notified within 7 business days</li>
                <li>Prizes must be claimed within 30 days</li>
                <li>Tax obligations are the responsibility of winners</li>
                <li>We reserve the right to verify eligibility</li>
              </ul>
            </div>
          </section>

          {/* Intellectual Property */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Intellectual Property</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>All content on our platform, including but not limited to text, graphics, logos, and software, is our property or licensed to us.</p>
              <p>You may not reproduce, distribute, or create derivative works without our express written permission.</p>
            </div>
          </section>

          {/* Prohibited Conduct */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Prohibited Conduct</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>You agree not to:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Use the service for any unlawful purpose</li>
                <li>Attempt to gain unauthorized access to our systems</li>
                <li>Interfere with other users&apos; enjoyment of the service</li>
                <li>Upload malicious code or content</li>
                <li>Engage in cheating or fraudulent activities</li>
              </ul>
            </div>
          </section>

          {/* Limitation of Liability */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Limitation of Liability</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>We shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the service.</p>
              <p>Our total liability shall not exceed the amount you paid for the service in the 12 months preceding the claim.</p>
            </div>
          </section>

          {/* Changes to Terms */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Changes to Terms</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>We reserve the right to modify these terms at any time. Changes will be effective immediately upon posting.</p>
              <p>Your continued use of the service after changes constitutes acceptance of the new terms.</p>
            </div>
          </section>

          {/* Contact Information */}
          <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">Contact Us</h2>
            <div className="text-gray-300 space-y-3 text-sm sm:text-base leading-relaxed">
              <p>If you have any questions about these Terms of Service, please contact us:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Email: legal@1think2win.com</li>
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
              href="/privacy" 
              className="text-blue-400 hover:text-blue-300 transition-colors duration-200 text-sm sm:text-base touch-target"
            >
              Privacy Policy
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