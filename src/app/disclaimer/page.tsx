'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function DisclaimerPage() {
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
              <div className="bg-gradient-to-r from-orange-500 to-red-600 p-2 sm:p-3 rounded-full border border-white/20 shadow-lg">
                <span className="text-white text-xl sm:text-2xl">⚠️</span>
              </div>
            </div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold text-white mb-3 sm:mb-4">
              Important Disclaimer
            </h1>
            <p className="text-sm sm:text-base lg:text-lg text-gray-300 leading-relaxed">
              Please read this disclaimer carefully before using our platform
            </p>
            <p className="text-xs sm:text-sm text-gray-400 mt-2">
              Last updated: {new Date().toLocaleDateString()}
            </p>
          </div>

          <div className="prose prose-blue max-w-none space-y-6 sm:space-y-8">
            
            {/* Entertainment Purpose Section */}
            <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-3 sm:mb-4 flex items-center">
                <span className="bg-blue-500/20 border border-blue-500/30 rounded-full w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center mr-2 sm:mr-3 flex-shrink-0">
                  <span className="text-blue-400 text-lg sm:text-xl">🎮</span>
                </span>
                <span className="leading-tight">Entertainment and Educational Purpose Only</span>
              </h2>
              <div className="space-y-3 sm:space-y-4 text-gray-200">
                <p className="text-sm sm:text-base leading-relaxed">
                  <strong className="text-white">1Think 2Win</strong> is designed and operated exclusively for <strong className="text-blue-400">entertainment and educational purposes</strong>. This platform serves as a skill-based quiz application that tests users&apos; knowledge of cricket and general topics while providing an engaging and fun experience.
                </p>
                <p className="text-sm sm:text-base leading-relaxed">
                  The primary objectives of this platform are to:
                </p>
                <ul className="list-disc pl-4 sm:pl-6 space-y-1 sm:space-y-2 text-sm sm:text-base">
                  <li>Enhance users&apos; cricket knowledge and general awareness</li>
                  <li>Provide an interactive learning environment</li>
                  <li>Foster healthy competition among cricket enthusiasts</li>
                  <li>Develop cognitive skills through quiz-based challenges</li>
                  <li>Create a community of knowledge seekers and sports lovers</li>
                </ul>
              </div>
            </section>

            {/* Not Gambling Section */}
            <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-3 sm:mb-4 flex items-center">
                <span className="bg-red-500/20 border border-red-500/30 rounded-full w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center mr-2 sm:mr-3 flex-shrink-0">
                  <span className="text-red-400 text-lg sm:text-xl">🚫</span>
                </span>
                <span className="leading-tight">Not a Gambling Platform</span>
              </h2>
              <div className="space-y-3 sm:space-y-4 text-gray-200">
                <p className="text-sm sm:text-base leading-relaxed">
                  <strong className="text-red-400">IMPORTANT NOTICE:</strong> This platform is <strong className="text-white">NOT a gambling website</strong> and does not facilitate any form of gambling activities. We explicitly state that:
                </p>
                <ul className="list-disc pl-4 sm:pl-6 space-y-1 sm:space-y-2 text-sm sm:text-base">
                  <li><strong className="text-white">No gambling activities:</strong> This platform does not offer betting, wagering, or any games of chance</li>
                  <li><strong className="text-white">Skill-based system:</strong> All activities are based on knowledge, skill, and educational content</li>
                  <li><strong className="text-white">No random outcomes:</strong> Results are determined by user performance and knowledge, not by chance</li>
                  <li><strong className="text-white">Educational focus:</strong> The platform promotes learning and skill development</li>
                  <li><strong className="text-white">Transparent operations:</strong> All processes are clear, fair, and based on merit</li>
                </ul>
                <div className="glass-card-blue rounded-lg p-3 sm:p-4 mt-3 sm:mt-4">
                  <p className="text-xs sm:text-sm font-medium text-red-300">
                    <strong>⚠️ Warning:</strong> If you are seeking gambling or betting opportunities, this platform is not suitable for you. Please seek appropriate licensed gambling platforms if that is your intention.
                  </p>
                </div>
              </div>
            </section>

            {/* Pakistan Cyber Law Compliance */}
            <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-3 sm:mb-4 flex items-center">
                <span className="bg-green-500/20 border border-green-500/30 rounded-full w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center mr-2 sm:mr-3 flex-shrink-0">
                  <span className="text-green-400 text-lg sm:text-xl">🇵🇰</span>
                </span>
                <span className="leading-tight">Pakistan Cyber Law Compliance</span>
              </h2>
              <div className="space-y-3 sm:space-y-4 text-gray-200">
                <p className="text-sm sm:text-base leading-relaxed">
                  This platform operates in full compliance with the <strong className="text-green-400">Prevention of Electronic Crimes Act (PECA) 2016</strong> and all applicable cyber laws of Pakistan. We are committed to maintaining the highest standards of legal compliance and ethical operations.
                </p>
                
                <h3 className="text-base sm:text-lg font-semibold text-white mt-4 sm:mt-6 mb-2 sm:mb-3">Legal Compliance Framework:</h3>
                <ul className="list-disc pl-4 sm:pl-6 space-y-1 sm:space-y-2 text-sm sm:text-base">
                  <li><strong className="text-white">PECA 2016 Compliance:</strong> Full adherence to Pakistan&apos;s primary cyber crime legislation</li>
                  <li><strong className="text-white">Data Protection:</strong> Compliance with data privacy and protection requirements</li>
                  <li><strong className="text-white">Content Regulations:</strong> All content meets Pakistani digital content standards</li>
                  <li><strong className="text-white">Financial Regulations:</strong> Adherence to State Bank of Pakistan guidelines for digital transactions</li>
                  <li><strong className="text-white">Consumer Protection:</strong> Full compliance with consumer rights and protection laws</li>
                </ul>

                <h3 className="text-base sm:text-lg font-semibold text-white mt-4 sm:mt-6 mb-2 sm:mb-3">Regulatory Authorities Recognition:</h3>
                <ul className="list-disc pl-4 sm:pl-6 space-y-1 sm:space-y-2 text-sm sm:text-base">
                  <li><strong className="text-white">Pakistan Telecommunication Authority (PTA):</strong> Operating within PTA guidelines</li>
                  <li><strong className="text-white">Federal Investigation Agency (FIA):</strong> Compliant with FIA cyber crime regulations</li>
                  <li><strong className="text-white">State Bank of Pakistan (SBP):</strong> Following SBP digital payment regulations</li>
                  <li><strong className="text-white">Competition Commission of Pakistan (CCP):</strong> Adherence to fair competition practices</li>
                </ul>

                <div className="glass-card-blue rounded-lg p-3 sm:p-4 mt-3 sm:mt-4">
                  <p className="text-xs sm:text-sm font-medium text-green-300">
                    <strong>✅ Legal Assurance:</strong> This platform has been designed with legal consultation to ensure complete compliance with Pakistani cyber laws and regulations.
                  </p>
                </div>
              </div>
            </section>

            {/* User Responsibilities */}
            <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-3 sm:mb-4 flex items-center">
                <span className="bg-purple-500/20 border border-purple-500/30 rounded-full w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center mr-2 sm:mr-3 flex-shrink-0">
                  <span className="text-purple-400 text-lg sm:text-xl">👤</span>
                </span>
                <span className="leading-tight">User Responsibilities and Age Requirements</span>
              </h2>
              <div className="space-y-3 sm:space-y-4 text-gray-200">
                <p className="text-sm sm:text-base leading-relaxed">
                  By using this platform, users acknowledge and agree to the following responsibilities:
                </p>
                <ul className="list-disc pl-4 sm:pl-6 space-y-1 sm:space-y-2 text-sm sm:text-base">
                  <li><strong className="text-white">Age Requirement:</strong> Users must be at least 18 years old to participate</li>
                  <li><strong className="text-white">Legal Capacity:</strong> Users must have the legal capacity to enter into agreements</li>
                  <li><strong className="text-white">Accurate Information:</strong> Provide truthful and accurate personal information</li>
                  <li><strong className="text-white">Responsible Use:</strong> Use the platform only for its intended educational and entertainment purposes</li>
                  <li><strong className="text-white">Compliance:</strong> Adhere to all applicable local, national, and international laws</li>
                  <li><strong className="text-white">Account Security:</strong> Maintain the confidentiality of account credentials</li>
                </ul>
              </div>
            </section>

            {/* Legal Protection */}
            <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-3 sm:mb-4 flex items-center">
                <span className="bg-yellow-500/20 border border-yellow-500/30 rounded-full w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center mr-2 sm:mr-3 flex-shrink-0">
                  <span className="text-yellow-400 text-lg sm:text-xl">⚖️</span>
                </span>
                <span className="leading-tight">Legal Protection and Liability</span>
              </h2>
              <div className="space-y-3 sm:space-y-4 text-gray-200">
                <p className="text-sm sm:text-base leading-relaxed">
                  This disclaimer serves as legal protection for both the platform operators and users. The following terms apply:
                </p>
                <ul className="list-disc pl-4 sm:pl-6 space-y-1 sm:space-y-2 text-sm sm:text-base">
                  <li><strong className="text-white">Platform Liability:</strong> The platform operates within legal boundaries and cannot be held liable for misuse by users</li>
                  <li><strong className="text-white">User Conduct:</strong> Users are solely responsible for their conduct and compliance with applicable laws</li>
                  <li><strong className="text-white">Dispute Resolution:</strong> Any disputes will be resolved according to Pakistani law and jurisdiction</li>
                  <li><strong className="text-white">Regulatory Changes:</strong> The platform will adapt to any changes in Pakistani cyber laws and regulations</li>
                  <li><strong className="text-white">Transparency:</strong> All operations are conducted transparently and in good faith</li>
                </ul>
                
                <div className="glass-card-blue rounded-lg p-3 sm:p-4 mt-3 sm:mt-4">
                  <p className="text-xs sm:text-sm font-medium text-yellow-300">
                    <strong>📋 Legal Notice:</strong> This disclaimer is legally binding and forms part of the terms of service. By using this platform, you acknowledge that you have read, understood, and agreed to all terms mentioned herein.
                  </p>
                </div>
              </div>
            </section>

            {/* Contact and Support */}
            <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition">
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-3 sm:mb-4 flex items-center">
                <span className="bg-cyan-500/20 border border-cyan-500/30 rounded-full w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center mr-2 sm:mr-3 flex-shrink-0">
                  <span className="text-cyan-400 text-lg sm:text-xl">📞</span>
                </span>
                <span className="leading-tight">Contact and Legal Inquiries</span>
              </h2>
              <div className="space-y-3 sm:space-y-4 text-gray-200">
                <p className="text-sm sm:text-base leading-relaxed">
                  For any legal inquiries, compliance questions, or concerns regarding this disclaimer, please contact us through the following channels:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-3 sm:mt-4">
                  <div className="glass-card-blue rounded-lg p-3 sm:p-4">
                    <h4 className="font-semibold text-white mb-2 text-sm sm:text-base">📧 Email Support</h4>
                    <p className="text-xs sm:text-sm text-cyan-300">legal@1think2win.com</p>
                    <p className="text-xs sm:text-sm text-cyan-300">support@1think2win.com</p>
                  </div>
                  <div className="glass-card-blue rounded-lg p-3 sm:p-4">
                    <h4 className="font-semibold text-white mb-2 text-sm sm:text-base">📱 Contact Information</h4>
                    <p className="text-xs sm:text-sm text-cyan-300">Phone: +92 XXX XXXXXXX</p>
                    <p className="text-xs sm:text-sm text-cyan-300">Business Hours: 9 AM - 6 PM PKT</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Final Acknowledgment */}
            <section className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 glass-transition text-center">
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-3 sm:mb-4">
                Acknowledgment and Agreement
              </h2>
              <p className="text-sm sm:text-base text-gray-200 leading-relaxed mb-4 sm:mb-6">
                By continuing to use <strong className="text-white">1Think 2Win</strong>, you acknowledge that you have read, understood, and agreed to this disclaimer in its entirety. You confirm that you understand this is an educational and entertainment platform, not a gambling site, and that it operates in full compliance with Pakistani cyber laws.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center">
                <Link 
                  href="/" 
                  className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg glass-transition text-sm sm:text-base text-center touch-manipulation min-h-[44px] flex items-center justify-center"
                >
                  Return to Home
                </Link>
                <Link 
                  href="/terms" 
                  className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-gray-600 to-gray-700 text-white font-medium rounded-lg glass-transition text-sm sm:text-base text-center touch-manipulation min-h-[44px] flex items-center justify-center"
                >
                  View Terms of Service
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}