'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function FAQPage() {
  const [isMobile, setIsMobile] = useState(false);
  const [openFAQ, setOpenFAQ] = useState<number | null>(null);

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

  const faqs = [
    {
      question: "What is 1Think 2Win?",
      answer: "1Think 2Win is a skill-based quiz platform focused on cricket knowledge and general awareness. It's designed for entertainment and educational purposes, helping users test and improve their cricket knowledge while having fun."
    },
    {
      question: "How do I participate in quizzes?",
      answer: "Simply create an account, browse available quizzes, and start playing! Each quiz tests your knowledge on various cricket topics. Your performance is based on your skill and knowledge, not chance."
    },
    {
      question: "Is this a gambling platform?",
      answer: "No, absolutely not! 1Think 2Win is NOT a gambling platform. It's a skill-based educational and entertainment platform that focuses on cricket knowledge. All outcomes are based on your knowledge and skills, not on chance or luck."
    },
    {
      question: "What age requirement is there?",
      answer: "Users must be at least 18 years old to participate in our platform. This ensures that all participants have the legal capacity to engage with our services responsibly."
    },
    {
      question: "Is the platform legal in Pakistan?",
      answer: "Yes, our platform operates in full compliance with Pakistani cyber laws, including the Prevention of Electronic Crimes Act (PECA) 2016. We maintain the highest standards of legal compliance and ethical operations."
    },
    {
      question: "How are quiz results determined?",
      answer: "Quiz results are determined purely by your knowledge, accuracy, and response time. There are no random elements or games of chance involved. Your performance directly reflects your cricket knowledge and quiz-taking skills."
    },
    {
      question: "Can I improve my cricket knowledge through this platform?",
      answer: "Absolutely! Our platform is designed to be educational. Each quiz helps you learn new facts about cricket, test your existing knowledge, and discover areas where you can improve. It's a great way to enhance your cricket expertise."
    },
    {
      question: "What topics are covered in the quizzes?",
      answer: "Our quizzes cover a wide range of cricket topics including player statistics, match history, rules and regulations, team information, tournament details, and general cricket trivia. We regularly update our question database."
    },
    {
      question: "How do I contact support?",
      answer: "You can reach our support team through multiple channels: email us at support@1think2win.com, use our contact form, or call our helpline during business hours (9 AM - 6 PM PKT). We're here to help with any questions or concerns."
    },
    {
      question: "Is my personal information safe?",
      answer: "Yes, we take data privacy seriously. We comply with all applicable data protection laws and implement robust security measures to protect your personal information. Your data is never shared with unauthorized third parties."
    }
  ];

  const toggleFAQ = (index: number) => {
    setOpenFAQ(openFAQ === index ? null : index);
  };

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
              <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-2 sm:p-3 rounded-full border border-white/20 shadow-lg">
                <span className="text-white text-xl sm:text-2xl">❓</span>
              </div>
            </div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold text-white mb-3 sm:mb-4">
              Frequently Asked Questions
            </h1>
            <p className="text-sm sm:text-base lg:text-lg text-gray-300 leading-relaxed">
              Find answers to common questions about 1Think 2Win
            </p>
          </div>

          {/* FAQ Items */}
          <div className="space-y-3 sm:space-y-4 mb-6 sm:mb-8 lg:mb-12">
            {faqs.map((faq, index) => (
              <div key={index} className="glass-card rounded-lg sm:rounded-xl glass-transition">
                <button
                  onClick={() => toggleFAQ(index)}
                  className="w-full text-left p-4 sm:p-5 lg:p-6 focus:outline-none focus:ring-2 focus:ring-blue-500/50 rounded-lg sm:rounded-xl touch-manipulation"
                  aria-expanded={openFAQ === index}
                  aria-controls={`faq-answer-${index}`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm sm:text-base lg:text-lg font-semibold text-white pr-3 sm:pr-4 leading-tight">
                      {faq.question}
                    </h3>
                    <div className={`flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 bg-blue-500/20 border border-blue-500/30 rounded-full flex items-center justify-center glass-transition ${openFAQ === index ? 'rotate-180' : ''}`}>
                      <span className="text-blue-400 text-sm sm:text-base">▼</span>
                    </div>
                  </div>
                </button>
                
                <div 
                  id={`faq-answer-${index}`}
                  className={`overflow-hidden glass-transition ${openFAQ === index ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}
                >
                  <div className="px-4 sm:px-5 lg:px-6 pb-4 sm:pb-5 lg:pb-6">
                    <div className="glass-card-blue rounded-lg p-3 sm:p-4">
                      <p className="text-xs sm:text-sm lg:text-base text-gray-200 leading-relaxed">
                        {faq.answer}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Contact Support Section */}
          <div className="glass-card rounded-lg sm:rounded-xl p-4 sm:p-6 lg:p-8 text-center glass-transition">
            <div className="flex items-center justify-center mb-3 sm:mb-4">
              <div className="bg-gradient-to-r from-green-500 to-teal-600 p-2 sm:p-3 rounded-full border border-white/20 shadow-lg">
                <span className="text-white text-lg sm:text-xl">💬</span>
              </div>
            </div>
            <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-3 sm:mb-4">
              Still Have Questions?
            </h2>
            <p className="text-sm sm:text-base text-gray-300 mb-4 sm:mb-6 leading-relaxed">
              Can&apos;t find the answer you&apos;re looking for? Our support team is here to help you with any questions or concerns.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center">
              <Link 
                href="/contact" 
                className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-green-600 to-teal-600 text-white font-medium rounded-lg glass-transition text-sm sm:text-base text-center touch-manipulation min-h-[44px] flex items-center justify-center"
              >
                Contact Support
              </Link>
              <Link 
                href="/" 
                className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg glass-transition text-sm sm:text-base text-center touch-manipulation min-h-[44px] flex items-center justify-center"
              >
                Back to Home
              </Link>
            </div>
          </div>

          {/* Additional Resources */}
          <div className="mt-6 sm:mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
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
              <span className="text-xs sm:text-sm font-medium text-white">Terms of Service</span>
            </Link>
            
            <Link 
              href="/privacy" 
              className="glass-card rounded-lg p-3 sm:p-4 text-center glass-transition touch-manipulation min-h-[80px] flex flex-col items-center justify-center sm:col-span-2 lg:col-span-1"
            >
              <span className="text-purple-400 text-lg sm:text-xl mb-1 sm:mb-2">🔒</span>
              <span className="text-xs sm:text-sm font-medium text-white">Privacy Policy</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}