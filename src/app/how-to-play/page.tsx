'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

export default function HowToPlayPage() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const mobileKeywords = ['mobile', 'android', 'iphone', 'ipad', 'tablet'];
      const isMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(isMobileUA || isSmallScreen);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-blue-dark py-8 sm:py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Animated Background Elements - Conditional for mobile */}
      {!isMobile && (
        <>
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
            <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-400/5 rounded-full blur-3xl animate-pulse delay-500"></div>
          </div>
        </>
      )}
      
      <div className="max-w-4xl mx-auto relative z-10">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">How to Play TBCL Quiz</h1>
          <p className="text-lg text-gray-300 max-w-2xl mx-auto">
            Learn everything you need to know about participating in our cricket quizzes and winning amazing prizes!
          </p>
        </div>

        {/* Quick Start Guide */}
        <div className={`glass-card glass-border glass-transition ${!isMobile ? 'md:glass-hover' : ''} mb-8`}>
          <div className="bg-gradient-glass-blue glass-border-bottom p-6">
            <h2 className="text-2xl font-bold text-white mb-2">🚀 Quick Start Guide</h2>
            <p className="text-gray-300">Get started in just 5 simple steps!</p>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {[
                { step: 1, title: "Register", desc: "Create your account", icon: "👤" },
                { step: 2, title: "Browse Quizzes", desc: "Find active quizzes", icon: "📋" },
                { step: 3, title: "Pay Entry Fee", desc: "Just 2 PKR per quiz", icon: "💳" },
                { step: 4, title: "Answer Questions", desc: "Complete within time limit", icon: "⏰" },
                { step: 5, title: "Win Prizes", desc: "Get selected randomly", icon: "🏆" }
              ].map((item) => (
                <div key={item.step} className="text-center">
                  <div className="bg-blue-500/20 glass-border border-blue-500/30 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-3">
                    <span className="text-2xl">{item.icon}</span>
                  </div>
                  <h3 className="font-semibold text-white mb-1">{item.title}</h3>
                  <p className="text-sm text-gray-300">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detailed Instructions */}
        <div className="space-y-8">
          
          {/* Getting Started */}
          <div className={`glass-card glass-border glass-transition ${!isMobile ? 'md:glass-hover' : ''}`}>
            <div className="bg-gradient-glass-blue glass-border-bottom p-6">
              <h2 className="text-2xl font-bold text-white">🎯 Getting Started</h2>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="flex items-start space-x-4">
                  <div className="bg-blue-500/20 glass-border border-blue-500/30 rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-blue-400 font-bold">1</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-2">Create Your Account</h3>
                    <p className="text-gray-300 mb-2">
                      Register with your email and create a secure password. You&apos;ll need to verify your email address to start playing.
                    </p>
                    <Link href="/register" className="text-blue-400 md:hover:text-blue-300 glass-transition touch-manipulation">
                      Register Now →
                    </Link>
                  </div>
                </div>
                
                <div className="flex items-start space-x-4">
                  <div className="bg-blue-500/20 glass-border border-blue-500/30 rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-blue-400 font-bold">2</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-2">Complete Your Profile</h3>
                    <p className="text-gray-300 mb-2">
                      Add your personal information and shipping address. This is important for prize delivery if you win!
                    </p>
                    <Link href="/profile/edit" className="text-blue-400 md:hover:text-blue-300 glass-transition touch-manipulation">
                      Edit Profile →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quiz Participation */}
          <div className={`glass-card glass-border glass-transition ${!isMobile ? 'md:glass-hover' : ''}`}>
            <div className="bg-gradient-glass-blue glass-border-bottom p-6">
              <h2 className="text-2xl font-bold text-white">📝 Quiz Participation</h2>
            </div>
            <div className="p-6">
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-white mb-3">Entry Fee & Payment</h3>
                  <div className="bg-gradient-glass-dark glass-card glass-border rounded-lg p-4">
                    <ul className="space-y-2 text-gray-300">
                      <li className="flex items-center space-x-2">
                        <span className="text-blue-400">•</span>
                        <span><strong className="text-white">Entry Fee:</strong> 2 PKR per quiz</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <span className="text-blue-400">•</span>
                        <span><strong className="text-white">Payment:</strong> Secure online payment processing</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <span className="text-blue-400">•</span>
                        <span><strong className="text-white">Refund Policy:</strong> Non-refundable once quiz starts</span>
                      </li>
                    </ul>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-white mb-3">Quiz Rules</h3>
                  <div className="bg-gradient-glass-dark glass-card glass-border rounded-lg p-4">
                    <ul className="space-y-2 text-gray-300">
                      <li className="flex items-center space-x-2">
                        <span className="text-green-400">✓</span>
                        <span><strong className="text-white">Time Limit:</strong> 10 minutes per quiz</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <span className="text-green-400">✓</span>
                        <span><strong className="text-white">Questions:</strong> Multiple choice cricket questions</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <span className="text-green-400">✓</span>
                        <span><strong className="text-white">Attempts:</strong> One attempt per quiz per user</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <span className="text-green-400">✓</span>
                        <span><strong className="text-white">Completion:</strong> Must answer all questions to be eligible</span>
                      </li>
                    </ul>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-white mb-3">During the Quiz</h3>
                  <div className="bg-gradient-glass-dark glass-card glass-border rounded-lg p-4">
                    <ul className="space-y-2 text-gray-300">
                      <li className="flex items-start space-x-2">
                        <span className="text-yellow-400 mt-1">⚠️</span>
                        <span>Keep an eye on the timer - you have 10 minutes to complete all questions</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-yellow-400 mt-1">⚠️</span>
                        <span>You can navigate between questions and change answers before submitting</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-yellow-400 mt-1">⚠️</span>
                        <span>If you lose internet connection, your progress is saved automatically</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-yellow-400 mt-1">⚠️</span>
                        <span>Submit your quiz before time runs out to be eligible for prizes</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Prizes & Winning */}
          <div className={`glass-card glass-border glass-transition ${!isMobile ? 'md:glass-hover' : ''}`}>
            <div className="bg-gradient-glass-blue glass-border-bottom p-6">
              <h2 className="text-2xl font-bold text-white">🏆 Prizes & Winning</h2>
            </div>
            <div className="p-6">
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-white mb-3">Available Prizes</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { name: "CD 70 Bike", icon: "🏍️", desc: "Honda CD 70 Motorcycle" },
                      { name: "Smartphone", icon: "📱", desc: "Latest Android Phone" },
                      { name: "Earbuds", icon: "🎧", desc: "Wireless Bluetooth Earbuds" },
                      { name: "Smart Watch", icon: "⌚", desc: "Fitness Smart Watch" }
                    ].map((prize) => (
                      <div key={prize.name} className="bg-gradient-glass-dark glass-card glass-border rounded-lg p-4 text-center">
                        <div className="text-3xl mb-2">{prize.icon}</div>
                        <h4 className="font-semibold text-white mb-1">{prize.name}</h4>
                        <p className="text-sm text-gray-300">{prize.desc}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4">
                    <Link href="/prizes" className={`text-blue-400 glass-transition touch-manipulation ${!isMobile ? 'md:hover:text-blue-300' : ''}`}>
                      View All Prizes →
                    </Link>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-white mb-3">How Winners Are Selected</h3>
                  <div className="bg-gradient-glass-dark glass-card glass-border rounded-lg p-4">
                    <div className="space-y-3">
                      <div className="flex items-start space-x-3">
                        <div className="bg-green-500/20 glass-border border-green-500/30 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-green-400 text-sm">1</span>
                        </div>
                        <div>
                          <p className="text-white font-medium">Random Selection</p>
                          <p className="text-gray-300 text-sm">Winners are randomly selected from all participants who completed the quiz</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="bg-green-500/20 glass-border border-green-500/30 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-green-400 text-sm">2</span>
                        </div>
                        <div>
                          <p className="text-white font-medium">Fair Chance</p>
                          <p className="text-gray-300 text-sm">Every participant has an equal opportunity to win, regardless of score</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="bg-green-500/20 glass-border border-green-500/30 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-green-400 text-sm">3</span>
                        </div>
                        <div>
                          <p className="text-white font-medium">Instant Notification</p>
                          <p className="text-gray-300 text-sm">Winners are notified immediately after the quiz ends</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-white mb-3">Prize Delivery Process</h3>
                  <div className="bg-gradient-glass-dark glass-card glass-border rounded-lg p-4">
                    <ol className="space-y-2 text-gray-300">
                      <li className="flex items-start space-x-2">
                        <span className="text-blue-400 font-bold">1.</span>
                        <span><strong className="text-white">Win Notification:</strong> You&apos;ll receive an in-app and email notification</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-blue-400 font-bold">2.</span>
                        <span><strong className="text-white">Provide Details:</strong> Submit your shipping address within 14 days</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-blue-400 font-bold">3.</span>
                        <span><strong className="text-white">Prize Delivery:</strong> We&apos;ll deliver your prize within 14 business days</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-blue-400 font-bold">4.</span>
                        <span><strong className="text-white">Tracking:</strong> You&apos;ll receive tracking information for your shipment</span>
                      </li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Points & Leaderboard */}
          <div className={`glass-card glass-border glass-transition ${!isMobile ? 'md:glass-hover' : ''}`}>
            <div className="bg-gradient-glass-blue glass-border-bottom p-6">
              <h2 className="text-2xl font-bold text-white">📊 Points & Leaderboard</h2>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-white mb-3">How Points Work</h3>
                  <div className="bg-gradient-glass-dark glass-card glass-border rounded-lg p-4">
                    <ul className="space-y-2 text-gray-300">
                      <li className="flex items-center space-x-2">
                        <span className="text-yellow-400">⭐</span>
                        <span>Earn points based on your quiz performance</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <span className="text-yellow-400">⭐</span>
                        <span>Top 10% performers in each quiz receive bonus points</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <span className="text-yellow-400">⭐</span>
                        <span>Use points to redeem additional prizes</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <span className="text-yellow-400">⭐</span>
                        <span>Track your progress on the leaderboard</span>
                      </li>
                    </ul>
                  </div>
                </div>
                
                <div className="flex space-x-4">
                  <Link 
                    href="/leaderboard" 
                    className={`inline-flex items-center px-4 py-2 glass-card-blue glass-border-blue glass-transition text-white rounded-md touch-manipulation ${!isMobile ? 'md:glass-hover-blue' : ''}`}
                  >
                    View Leaderboard
                  </Link>
                  <Link 
                    href="/profile" 
                    className={`inline-flex items-center px-4 py-2 glass-card glass-border glass-transition text-white rounded-md touch-manipulation ${!isMobile ? 'md:glass-hover' : ''}`}
                  >
                    Check My Points
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Tips & Strategies */}
          <div className={`glass-card glass-border glass-transition ${!isMobile ? 'md:glass-hover' : ''}`}>
            <div className="bg-gradient-glass-blue glass-border-bottom p-6">
              <h2 className="text-2xl font-bold text-white">💡 Tips & Strategies</h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold text-white mb-3">Quiz Tips</h3>
                  <ul className="space-y-2 text-gray-300">
                    <li className="flex items-start space-x-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>Read questions carefully before answering</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>Manage your time wisely - don&apos;t spend too long on one question</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>Review your answers before submitting</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>Stay updated with cricket news and statistics</span>
                    </li>
                  </ul>
                </div>
                
                <div>
                  <h3 className="font-semibold text-white mb-3">Winning Strategies</h3>
                  <ul className="space-y-2 text-gray-300">
                    <li className="flex items-start space-x-2">
                      <span className="text-blue-400 mt-1">🎯</span>
                      <span>Participate in multiple quizzes to increase your chances</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-blue-400 mt-1">🎯</span>
                      <span>Complete your profile for faster prize delivery</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-blue-400 mt-1">🎯</span>
                      <span>Check for new quizzes regularly</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-blue-400 mt-1">🎯</span>
                      <span>Build your cricket knowledge for better performance</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* FAQ Section */}
          <div className={`glass-card glass-border glass-transition ${!isMobile ? 'md:glass-hover' : ''}`}>
            <div className="bg-gradient-glass-blue glass-border-bottom p-6">
              <h2 className="text-2xl font-bold text-white">❓ Frequently Asked Questions</h2>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {[
                  {
                    q: "Can I participate in the same quiz multiple times?",
                    a: "No, each user is allowed only one attempt per quiz to ensure fairness."
                  },
                  {
                    q: "What happens if I lose internet connection during a quiz?",
                    a: "Your progress is automatically saved. You can continue when you reconnect if the quiz is still active."
                  },
                  {
                    q: "How long do I have to claim my prize?",
                    a: "You have 14 days to provide your shipping details after winning notification."
                  },
                  {
                    q: "Can I get a refund if I don't win?",
                    a: "Entry fees are non-refundable once you start a quiz, as stated in our terms."
                  }
                ].map((faq, index) => (
                  <div key={index} className="bg-gradient-glass-dark glass-card glass-border rounded-lg p-4">
                    <h4 className="font-semibold text-white mb-2">{faq.q}</h4>
                    <p className="text-gray-300">{faq.a}</p>
                  </div>
                ))}
              </div>
              
              <div className="mt-6">
                <Link href="/faq" className={`text-blue-400 glass-transition touch-manipulation ${!isMobile ? 'md:hover:text-blue-300' : ''}`}>
                  View All FAQs →
                </Link>
              </div>
            </div>
          </div>

          {/* Call to Action */}
          <div className={`glass-card glass-border glass-transition text-center ${!isMobile ? 'md:glass-hover' : ''}`}>
            <div className="p-8">
              <h2 className="text-2xl font-bold text-white mb-4">Ready to Start Playing?</h2>
              <p className="text-gray-300 mb-6">
                Join thousands of cricket fans competing for amazing prizes. Your next win could be just one quiz away!
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link 
                  href="/quizzes" 
                  className={`inline-flex items-center px-6 py-3 glass-card-blue glass-border-blue glass-transition text-white font-medium rounded-md touch-manipulation ${!isMobile ? 'md:glass-hover-blue' : ''}`}
                >
                  Browse Active Quizzes
                </Link>
                <Link 
                  href="/register" 
                  className={`inline-flex items-center px-6 py-3 glass-card glass-border glass-transition text-white font-medium rounded-md touch-manipulation ${!isMobile ? 'md:glass-hover' : ''}`}
                >
                  Create Account
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}