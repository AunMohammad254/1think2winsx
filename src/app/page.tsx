'use client';

import Image from "next/image";
import LazySection from '@/components/LazySection';
import Link from "next/link";
import { memo, useMemo } from 'react';

// Memoized components for better performance
const HeroSection = memo(() => (
  <section className="relative bg-gradient-blue-dark text-white py-20 overflow-hidden">
    {/* Simplified Background Elements - Desktop only */}
    <div className="absolute inset-0 overflow-hidden">
      <div className="hidden md:block absolute -top-40 -right-40 w-80 h-80 bg-blue-500/10 rounded-full blur-xl animate-pulse"></div>
      <div className="hidden md:block absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-xl animate-pulse delay-1000"></div>
      <div className="hidden md:block absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-500/5 rounded-full blur-xl animate-pulse delay-500"></div>
      
      {/* Mobile-friendly static background */}
      <div className="md:hidden absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5"></div>
    </div>
    
    <div className="container mx-auto px-4 flex flex-col md:flex-row items-center gap-12 relative z-10">
      <div className="md:w-1/2 space-y-8">
        <div className="space-y-6">
          <h1 className="text-5xl md:text-7xl font-black leading-tight">
            <span className="bg-gradient-to-r from-white via-blue-100 to-cyan-200 bg-clip-text text-transparent">
              Test Your
            </span>
            <br />
            <span className="bg-gradient-to-r from-cyan-200 via-blue-200 to-white bg-clip-text text-transparent">
              Cricket Knowledge
            </span>
            <br />
            <span className="bg-gradient-to-r from-yellow-300 via-orange-300 to-red-300 bg-clip-text text-transparent">
              & Win Big!
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-200 leading-relaxed font-light">
            Join the <span className="font-bold text-cyan-300">1Think 2Win</span> quiz competition and get a chance to win amazing prizes including bikes, phones, earbuds, and smart watches.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-6">
          <Link 
            href="/quizzes" 
            className="group relative px-8 py-4 bg-gradient-to-r from-white to-blue-50 text-blue-700 rounded-2xl font-bold text-lg shadow-lg transform transition-transform duration-200 active:scale-95 md:hover:scale-105 touch-manipulation"
          >
            <span className="relative z-10">🎯 Play Now</span>
            <div className="hidden md:block absolute inset-0 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <span className="hidden md:block absolute inset-0 flex items-center justify-center text-white font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
              🚀 Start Quiz
            </span>
          </Link>
          <Link 
            href="/how-to-play" 
            className="group px-8 py-4 border-2 border-white/30 bg-white/10 rounded-2xl font-bold text-lg shadow-lg transform transition-transform duration-200 active:scale-95 md:hover:scale-105 md:hover:bg-white/20 md:hover:border-white/50 touch-manipulation"
          >
            <span className="flex items-center gap-2">
              📚 How to Play
              <span className="transform md:group-hover:translate-x-1 transition-transform duration-300">→</span>
            </span>
          </Link>
        </div>
      </div>
      
      <div className="md:w-1/2 flex justify-center">
        <div className="relative">
          {/* Simplified 3D Container - Mobile optimized */}
          <div className="relative w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96">
            {/* Background glow - Desktop only */}
            <div className="hidden md:block absolute inset-0 bg-gradient-to-r from-blue-400/20 to-cyan-400/20 rounded-full blur-xl animate-pulse"></div>
            
            {/* Rotating rings - Desktop only */}
            <div className="hidden lg:block absolute inset-4 border-2 border-blue-300/30 rounded-full animate-spin" style={{animationDuration: '20s'}}></div>
            <div className="hidden lg:block absolute inset-8 border border-cyan-300/20 rounded-full animate-spin" style={{animationDuration: '15s', animationDirection: 'reverse'}}></div>
            
            {/* Main image container - Simplified for mobile */}
            <div className="absolute inset-8 sm:inset-12 bg-gradient-to-br from-white/10 to-blue-500/10 rounded-full border border-white/20 shadow-lg transform transition-transform duration-200 active:scale-95 md:hover:scale-110">
              <div className="relative w-full h-full p-4 sm:p-8">
                <Image 
                  src="/quiz-hero.svg" 
                  alt="Cricket Quiz" 
                  fill
                  className="object-contain drop-shadow-lg transform transition-transform duration-200 active:scale-95 md:hover:scale-105"
                  priority
                />
              </div>
            </div>
            
            {/* Floating elements - Reduced on mobile */}
            <div className="absolute -top-2 -right-2 sm:-top-4 sm:-right-4 w-6 h-6 sm:w-8 sm:h-8 bg-yellow-400 rounded-full shadow-lg md:animate-bounce"></div>
            <div className="absolute -bottom-2 -left-2 sm:-bottom-4 sm:-left-4 w-4 h-4 sm:w-6 sm:h-6 bg-green-400 rounded-full shadow-lg md:animate-bounce md:delay-500"></div>
            <div className="hidden lg:block absolute top-1/2 -left-8 w-4 h-4 bg-red-400 rounded-full animate-bounce delay-1000 shadow-lg"></div>
            <div className="hidden lg:block absolute top-1/4 -right-8 w-5 h-5 bg-purple-400 rounded-full animate-bounce delay-700 shadow-lg"></div>
          </div>
        </div>
      </div>
    </div>
  </section>
));
HeroSection.displayName = 'HeroSection';

const StepCard = memo(({ step, title, description, gradient, delay }: {
  step: number;
  title: string;
  description: string;
  gradient: string;
  delay: string;
}) => (
  <div className="group relative">
    <div className={`absolute inset-0 ${gradient} rounded-3xl blur-xl hidden md:block md:group-hover:blur-2xl transition-all duration-500`}></div>
    <div className="relative glass-card-blue p-8 rounded-3xl border border-blue-400/20 transform md:group-hover:scale-105 md:group-hover:-translate-y-2 transition-all duration-500 shadow-2xl touch-manipulation">
      <div className="text-center space-y-6">
        <div className="relative mx-auto w-20 h-20 mb-6">
          <div className={`absolute inset-0 ${gradient.replace('/20', '')} rounded-2xl hidden md:animate-pulse ${delay}`}></div>
          <div className="relative w-full h-full bg-white rounded-2xl flex items-center justify-center shadow-xl transform md:group-hover:rotate-12 transition-transform duration-500">
            <span className="text-3xl font-black text-blue-600">{step}</span>
          </div>
        </div>
        <h3 className="text-2xl font-bold text-white mb-4">{title}</h3>
        <p className="text-gray-300 leading-relaxed" dangerouslySetInnerHTML={{ __html: description }} />
      </div>
    </div>
  </div>
));
StepCard.displayName = 'StepCard';

const PrizeCard = memo(({ icon, title, description, gradient, badge, delay }: {
  icon: string;
  title: string;
  description: string;
  gradient: string;
  badge: string;
  delay: string;
}) => (
  <div className="group relative">
    <div className={`absolute inset-0 ${gradient} rounded-3xl blur-xl hidden md:block md:group-hover:blur-2xl transition-all duration-500`}></div>
    <div className="relative glass-card-blue p-6 rounded-3xl border border-red-400/20 transform md:group-hover:scale-105 md:group-hover:-translate-y-4 transition-all duration-500 shadow-2xl touch-manipulation">
      <div className="text-center space-y-4">
        <div className="relative mx-auto w-24 h-24 mb-4">
          <div className={`absolute inset-0 ${gradient.replace('/20', '')} rounded-2xl hidden md:animate-pulse ${delay}`}></div>
          <div className="relative w-full h-full bg-white rounded-2xl flex items-center justify-center shadow-xl transform md:group-hover:rotate-12 transition-transform duration-500">
            <span className="text-4xl">{icon}</span>
          </div>
        </div>
        <h3 className="text-2xl font-bold text-white">{title}</h3>
        <p className="text-gray-300 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: description }} />
        <div className="pt-2">
          <span className={`inline-block px-4 py-2 ${gradient} rounded-full text-orange-300 text-sm font-semibold border border-orange-400/30`}>
            {badge}
          </span>
        </div>
      </div>
    </div>
  </div>
));
PrizeCard.displayName = 'PrizeCard';

const StatCard = memo(({ value, label, color }: {
  value: string;
  label: string;
  color: string;
}) => (
  <div className="group">
    <div className={`glass-card-blue p-4 rounded-2xl border ${color} transform md:group-hover:scale-105 transition-all duration-300 touch-manipulation`}>
      <div className={`text-2xl md:text-3xl font-black ${color.replace('border-', 'text-').replace('/20', '')} mb-1`}>{value}</div>
      <div className="text-sm text-gray-300">{label}</div>
    </div>
  </div>
));
StatCard.displayName = 'StatCard';

export default function Home() {
  // Memoized data to prevent re-creation on every render
  const stepData = useMemo(() => [
    {
      step: 1,
      title: "Register & Pay",
      description: 'Create an account and pay just <span class="font-bold text-cyan-300">2 PKR</span> to enter the quiz competition',
      gradient: "bg-gradient-to-r from-blue-600/20 to-cyan-600/20",
      delay: ""
    },
    {
      step: 2,
      title: "Answer Questions",
      description: 'Test your cricket knowledge with our challenging <span class="font-bold text-pink-300">tape ball cricket</span> questions',
      gradient: "bg-gradient-to-r from-purple-600/20 to-pink-600/20",
      delay: "md:delay-200"
    },
    {
      step: 3,
      title: "Win Prizes",
      description: 'Random winners are selected after each quiz session to win <span class="font-bold text-yellow-300">exciting prizes</span>!',
      gradient: "bg-gradient-to-r from-green-600/20 to-yellow-600/20",
      delay: "md:delay-500"
    }
  ], []);

  const prizeData = useMemo(() => [
    {
      icon: "🏍️",
      title: "Bike",
      description: 'Win a brand new motorcycle worth <span class="font-bold text-orange-300">PKR 150,000+</span>',
      gradient: "bg-gradient-to-r from-red-500/20 to-orange-500/20",
      badge: "Grand Prize",
      delay: ""
    },
    {
      icon: "📱",
      title: "Smartphone",
      description: 'Latest smartphone worth <span class="font-bold text-cyan-300">PKR 50,000+</span>',
      gradient: "bg-gradient-to-r from-blue-500/20 to-cyan-500/20",
      badge: "Premium Prize",
      delay: "md:delay-200"
    },
    {
      icon: "🎧",
      title: "Wireless Earbuds",
      description: 'Premium wireless earbuds worth <span class="font-bold text-pink-300">PKR 15,000+</span>',
      gradient: "bg-gradient-to-r from-purple-500/20 to-pink-500/20",
      badge: "Popular Prize",
      delay: "md:delay-500"
    },
    {
      icon: "⌚",
      title: "Smart Watch",
      description: 'Advanced smartwatch worth <span class="font-bold text-emerald-300">PKR 25,000+</span>',
      gradient: "bg-gradient-to-r from-green-500/20 to-emerald-500/20",
      badge: "Tech Prize",
      delay: "md:delay-700"
    }
  ], []);

  const statsData = useMemo(() => [
    { value: "1000+", label: "Active Players", color: "border-blue-400/20" },
    { value: "10K+", label: "Prizes Won", color: "border-purple-400/20" },
    { value: "500+", label: "Quizzes Taken", color: "border-green-400/20" },
    { value: "24/7", label: "Available", color: "border-yellow-400/20" }
  ], []);

  return (
    <div className="flex flex-col overflow-hidden">
      <HeroSection />

      {/* How It Works Section with 3D Cards */}
      <LazySection 
        className="py-20 bg-gradient-to-br from-gray-900 via-blue-900/20 to-gray-900 relative overflow-hidden"
        rootMargin="100px"
        delay={50}
      >
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-blue-500/5 to-purple-500/5"></div>
          <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-cyan-400/10 rounded-full blur-2xl"></div>
          <div className="absolute bottom-1/4 right-1/4 w-40 h-40 bg-blue-400/10 rounded-full blur-2xl"></div>
        </div>
        
        <div className="container mx-auto px-4 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-6xl font-black mb-6">
              <span className="bg-gradient-to-r from-white via-blue-200 to-cyan-300 bg-clip-text text-transparent">
                How It Works
              </span>
            </h2>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
              Simple steps to start your cricket quiz journey and win amazing prizes
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {stepData.map((step) => (
              <StepCard key={step.step} {...step} />
            ))}
          </div>
        </div>
      </LazySection>

      {/* Prize Showcase with 3D Effects */}
      <LazySection 
        className="py-20 bg-gradient-to-br from-gray-900 via-purple-900/10 to-gray-900 relative overflow-hidden"
        rootMargin="100px"
        delay={100}
      >
        {/* Animated Background */}
        <div className="absolute inset-0">
          <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-l from-purple-500/10 to-transparent rounded-full blur-3xl hidden md:animate-pulse"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-r from-blue-500/10 to-transparent rounded-full blur-3xl hidden md:animate-pulse md:delay-1000"></div>
        </div>
        
        <div className="container mx-auto px-4 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-6xl font-black mb-6">
              <span className="bg-gradient-to-r from-yellow-300 via-orange-300 to-red-400 bg-clip-text text-transparent">
                Amazing Prizes
              </span>
            </h2>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
              Win incredible prizes worth thousands of rupees in our cricket quiz competition
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
            {prizeData.map((prize, index) => (
              <PrizeCard key={index} {...prize} />
            ))}
          </div>
        </div>
      </LazySection>

      {/* CTA Section with 3D Effects */}
      <section className="py-20 bg-gradient-to-br from-blue-900 via-purple-900/30 to-blue-900 relative overflow-hidden">
        {/* Animated Background Elements - Desktop Only */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-64 h-64 bg-gradient-to-r from-blue-400/10 to-cyan-400/10 rounded-full blur-3xl hidden md:animate-pulse"></div>
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-gradient-to-l from-purple-400/10 to-pink-400/10 rounded-full blur-3xl hidden md:animate-pulse md:delay-1000"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-r from-cyan-400/5 to-blue-400/5 rounded-full blur-3xl hidden md:animate-pulse md:delay-500"></div>
        </div>
        
        {/* Simplified Background for Mobile */}
        <div className="absolute inset-0 md:hidden">
          <div className="absolute top-0 left-1/4 w-32 h-32 bg-gradient-to-r from-blue-400/5 to-cyan-400/5 rounded-full"></div>
          <div className="absolute bottom-0 right-1/4 w-32 h-32 bg-gradient-to-l from-purple-400/5 to-pink-400/5 rounded-full"></div>
        </div>
        
        <div className="container mx-auto px-4 text-center relative z-10">
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="space-y-6">
              <h2 className="text-4xl md:text-6xl font-black leading-tight">
                <span className="bg-gradient-to-r from-white via-blue-100 to-cyan-200 bg-clip-text text-transparent">
                  Ready to Test Your
                </span>
                <br />
                <span className="bg-gradient-to-r from-cyan-200 via-blue-200 to-purple-200 bg-clip-text text-transparent">
                  Cricket Knowledge?
                </span>
              </h2>
              <p className="text-xl md:text-2xl text-gray-200 leading-relaxed max-w-2xl mx-auto">
                Join thousands of cricket fans and compete for amazing prizes. 
                <span className="font-bold text-cyan-300"> Start your quiz journey today!</span>
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center pt-8">
              <Link 
                href="/register" 
                className="group relative px-10 py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-2xl font-bold text-xl shadow-2xl transform transition-all duration-300 active:scale-95 sm:hover:scale-110 sm:hover:shadow-cyan-500/25 sm:hover:shadow-2xl touch-manipulation"
              >
                <span className="relative z-10 flex items-center gap-3">
                  🚀 Register Now
                  <span className="transform md:group-hover:translate-x-2 transition-transform duration-300">→</span>
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl opacity-0 md:group-hover:opacity-100 transition-opacity duration-300"></div>
              </Link>
              
              <div className="flex items-center gap-4 text-gray-300">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-400 rounded-full hidden md:animate-pulse"></div>
                  <span className="text-sm font-medium">Live Quiz Available</span>
                </div>
                <div className="w-px h-6 bg-gray-600"></div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🏆</span>
                  <span className="text-sm font-medium">Win Big Prizes</span>
                </div>
              </div>
            </div>
            
            {/* Stats Section */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-12 max-w-3xl mx-auto">
              {statsData.map((stat, index) => (
                <StatCard key={index} {...stat} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
