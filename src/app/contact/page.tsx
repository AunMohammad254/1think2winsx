'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function ContactPage() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const mobileKeywords = ['mobile', 'android', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone'];
      const isMobileUserAgent = mobileKeywords.some(keyword => userAgent.includes(keyword));
      const isMobileWidth = window.innerWidth <= 768;
      setIsMobile(isMobileUserAgent || isMobileWidth);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 py-4 sm:py-8 lg:py-12 px-3 sm:px-4 lg:px-6 relative overflow-hidden">
      {/* Optimized Background - Desktop Only */}
      {!isMobile && (
        <>
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%224%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20"></div>
          <div className="absolute top-0 left-0 w-full h-full">
            <div className="absolute top-1/4 left-1/4 w-72 h-72 lg:w-96 lg:h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse-optimized"></div>
            <div className="absolute bottom-1/4 right-1/4 w-72 h-72 lg:w-96 lg:h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse-optimized delay-1000"></div>
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-60 h-60 lg:w-72 lg:h-72 bg-cyan-500/10 rounded-full blur-3xl animate-pulse-optimized delay-500"></div>
          </div>
        </>
      )}

      {/* Simplified Background for Mobile */}
      {isMobile && (
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5"></div>
      )}

      <div className="max-w-4xl mx-auto relative z-10">
        <div className={`glass-card rounded-lg sm:rounded-xl lg:rounded-2xl shadow-2xl p-4 sm:p-6 lg:p-8 glass-transition ${!isMobile ? 'md:hover:shadow-blue-500/25' : ''}`}>
          
          {/* Header */}
          <div className="text-center mb-6 sm:mb-8 lg:mb-12">
            <div className="flex items-center justify-center mb-3 sm:mb-4">
              <div className="bg-gradient-to-r from-green-500 to-teal-600 p-2 sm:p-3 rounded-full border border-white/20 shadow-lg">
                <span className="text-white text-xl sm:text-2xl">📞</span>
              </div>
            </div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold text-white mb-3 sm:mb-4">
              Contact Us
            </h1>
            <p className="text-sm sm:text-base lg:text-lg text-gray-300 leading-relaxed">
              Get in touch with our support team for any questions or assistance
            </p>
          </div>

          {/* Contact Information Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 mb-6 sm:mb-8 lg:mb-12">
            
            {/* Email Contact */}
            <div className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
              <div className="flex items-center mb-3 sm:mb-4">
                <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-2 sm:p-3 rounded-full border border-white/20 shadow-lg mr-3 sm:mr-4">
                  <span className="text-white text-lg sm:text-xl">✉️</span>
                </div>
                <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white">Email Support</h2>
              </div>
              <p className="text-sm sm:text-base text-gray-300 mb-3 sm:mb-4 leading-relaxed">
                Send us an email and we&apos;ll get back to you within 24 hours
              </p>
              <div className="glass-card-blue rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
                <p className="text-xs sm:text-sm lg:text-base text-white font-medium">
                  support@1think2win.com
                </p>
              </div>
              <a 
                href="mailto:support@1think2win.com" 
                className="w-full inline-block px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg glass-transition text-sm sm:text-base text-center touch-manipulation min-h-[44px] flex items-center justify-center"
              >
                Send Email
              </a>
            </div>

            {/* Phone Contact */}
            <div className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
              <div className="flex items-center mb-3 sm:mb-4">
                <div className="bg-gradient-to-r from-green-500 to-teal-600 p-2 sm:p-3 rounded-full border border-white/20 shadow-lg mr-3 sm:mr-4">
                  <span className="text-white text-lg sm:text-xl">📱</span>
                </div>
                <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white">Phone Support</h2>
              </div>
              <p className="text-sm sm:text-base text-gray-300 mb-3 sm:mb-4 leading-relaxed">
                Call us during business hours for immediate assistance
              </p>
              <div className="glass-card-blue rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
                <p className="text-xs sm:text-sm lg:text-base text-white font-medium">
                  +92-XXX-XXXXXXX
                </p>
                <p className="text-xs sm:text-sm text-gray-300 mt-1">
                  Business Hours: 9 AM - 6 PM (PKT)
                </p>
              </div>
              <a 
                href="tel:+92XXXXXXXXX" 
                className="w-full inline-block px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-green-600 to-teal-600 text-white font-medium rounded-lg glass-transition text-sm sm:text-base text-center touch-manipulation min-h-[44px] flex items-center justify-center"
              >
                Call Now
              </a>
            </div>
          </div>

          {/* Support Hours */}
          <div className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 text-center glass-transition mb-6 sm:mb-8">
            <div className="flex items-center justify-center mb-3 sm:mb-4">
              <div className="bg-gradient-to-r from-orange-500 to-red-600 p-2 sm:p-3 rounded-full border border-white/20 shadow-lg">
                <span className="text-white text-lg sm:text-xl">🕒</span>
              </div>
            </div>
            <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-3 sm:mb-4">
              Support Hours
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="glass-card-blue rounded-lg p-3 sm:p-4">
                <h3 className="text-sm sm:text-base font-semibold text-white mb-1 sm:mb-2">Email Support</h3>
                <p className="text-xs sm:text-sm text-gray-300">24/7 - Response within 24 hours</p>
              </div>
              <div className="glass-card-blue rounded-lg p-3 sm:p-4">
                <h3 className="text-sm sm:text-base font-semibold text-white mb-1 sm:mb-2">Phone Support</h3>
                <p className="text-xs sm:text-sm text-gray-300">Monday - Friday: 9 AM - 6 PM (PKT)</p>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition mb-6 sm:mb-8">
            <div className="flex items-center justify-center mb-3 sm:mb-4">
              <div className="bg-gradient-to-r from-purple-500 to-pink-600 p-2 sm:p-3 rounded-full border border-white/20 shadow-lg">
                <span className="text-white text-lg sm:text-xl">🔗</span>
              </div>
            </div>
            <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-4 sm:mb-6 text-center">
              Quick Links
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <Link 
                href="/faq" 
                className="glass-card rounded-lg p-3 sm:p-4 text-center glass-transition touch-manipulation min-h-[80px] flex flex-col items-center justify-center"
              >
                <span className="text-blue-400 text-lg sm:text-xl mb-1 sm:mb-2">❓</span>
                <span className="text-xs sm:text-sm font-medium text-white">FAQ</span>
              </Link>
              
              <Link 
                href="/disclaimer" 
                className="glass-card rounded-lg p-3 sm:p-4 text-center glass-transition touch-manipulation min-h-[80px] flex flex-col items-center justify-center"
              >
                <span className="text-orange-400 text-lg sm:text-xl mb-1 sm:mb-2">⚠️</span>
                <span className="text-xs sm:text-sm font-medium text-white">Disclaimer</span>
              </Link>
              
              <Link 
                href="/terms" 
                className="glass-card rounded-lg p-3 sm:p-4 text-center glass-transition touch-manipulation min-h-[80px] flex flex-col items-center justify-center"
              >
                <span className="text-blue-400 text-lg sm:text-xl mb-1 sm:mb-2">📋</span>
                <span className="text-xs sm:text-sm font-medium text-white">Terms</span>
              </Link>
              
              <Link 
                href="/privacy" 
                className="glass-card rounded-lg p-3 sm:p-4 text-center glass-transition touch-manipulation min-h-[80px] flex flex-col items-center justify-center"
              >
                <span className="text-purple-400 text-lg sm:text-xl mb-1 sm:mb-2">🔒</span>
                <span className="text-xs sm:text-sm font-medium text-white">Privacy</span>
              </Link>
            </div>
          </div>

          {/* Additional Information */}
          <div className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 text-center glass-transition">
            <div className="flex items-center justify-center mb-3 sm:mb-4">
              <div className="bg-gradient-to-r from-cyan-500 to-blue-600 p-2 sm:p-3 rounded-full border border-white/20 shadow-lg">
                <span className="text-white text-lg sm:text-xl">ℹ️</span>
              </div>
            </div>
            <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-3 sm:mb-4">
              Need Help?
            </h2>
            <p className="text-sm sm:text-base text-gray-300 mb-4 sm:mb-6 leading-relaxed">
              Our dedicated support team is here to assist you with any questions about 1Think 2Win. 
              Whether you need help with your account, have questions about quizzes, or need technical support, 
              we&apos;re committed to providing you with the best possible experience.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center">
              <Link 
                href="/" 
                className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg glass-transition text-sm sm:text-base text-center touch-manipulation min-h-[44px] flex items-center justify-center"
              >
                Back to Home
              </Link>
              <Link 
                href="/faq" 
                className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-green-600 to-teal-600 text-white font-medium rounded-lg glass-transition text-sm sm:text-base text-center touch-manipulation min-h-[44px] flex items-center justify-center"
              >
                View FAQ
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}