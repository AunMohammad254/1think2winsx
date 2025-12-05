'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import LazyImage from '@/components/LazyImage';

// Define prize type
type Prize = {
  id: string;
  name: string;
  description: string;
  type: string;
  color: string;
  value: string;
  icon: string;
  features: string[];
};

// Enhanced prize data
const prizes: Prize[] = [
  {
    id: 'bike',
    name: 'CD 70 Bike',
    description: 'Win a brand new motorcycle with sleek design and excellent fuel efficiency.',
    type: 'bike',
    color: '#e53e3e',
    value: 'PKR 150,000',
    icon: '/bike.svg',
    features: ['Latest Model', 'Fuel Efficient', 'Stylish Design', 'Warranty Included']
  },
  {
    id: 'phone',
    name: 'Android Phone',
    description: 'Latest smartphone with amazing features, high-resolution camera, and long battery life.',
    type: 'phone',
    color: '#3182ce',
    value: 'PKR 80,000',
    icon: '/phone.svg',
    features: ['High-Res Camera', 'Long Battery Life', 'Latest Android', '5G Ready']
  },
  {
    id: 'earbuds',
    name: 'Wireless Earbuds',
    description: 'Premium wireless earbuds with noise cancellation and crystal clear sound quality.',
    type: 'earbuds',
    color: '#38a169',
    value: 'PKR 25,000',
    icon: '/earbuds.svg',
    features: ['Noise Cancellation', 'Wireless Charging', 'Premium Sound', 'Water Resistant']
  },
  {
    id: 'smartwatch',
    name: 'Smart Watch',
    description: 'Feature-packed smartwatch with health monitoring and notification capabilities.',
    type: 'smartwatch',
    color: '#805ad5',
    value: 'PKR 35,000',
    icon: '/smartwatch.svg',
    features: ['Health Monitoring', 'GPS Tracking', 'Water Proof', 'Long Battery']
  }
];

// Pure CSS 3D Coverflow Component with Performance Optimizations
function CoverflowSlider({ isMobile }: { isMobile: boolean }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Intersection Observer for performance optimization
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Auto-play functionality with performance optimization
  useEffect(() => {
    if (isAutoPlaying && isVisible) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % prizes.length);
      }, 4000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isAutoPlaying, isVisible]);

  // Optimized slide navigation with useCallback
  const goToSlide = useCallback((index: number) => {
    setCurrentIndex(index);
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 5000);
  }, []);

  const nextSlide = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % prizes.length);
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 5000);
  }, []);

  const prevSlide = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + prizes.length) % prizes.length);
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 5000);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-7xl mx-auto">
      {/* Coverflow Container */}
      <div className="relative h-[600px] md:h-[700px] lg:h-[800px] overflow-hidden">
        {/* 3D Perspective Container with GPU acceleration */}
        <div 
          className="relative w-full h-full flex items-center justify-center"
          style={{ 
            perspective: '1200px',
            transform: 'translateZ(0)', // Force GPU acceleration
            willChange: 'transform'
          }}
        >
          {/* Prize Cards */}
          {prizes.map((prize, index) => {
            const offset = index - currentIndex;
            const isActive = index === currentIndex;
            const isVisible = Math.abs(offset) <= 2; // Only render visible cards for performance
            
            if (!isVisible) return null;
            
            // Calculate transforms for coverflow effect
            const translateX = offset * 280;
            const translateZ = isActive ? 0 : -200;
            const rotateY = isActive ? 0 : offset > 0 ? -45 : 45;
            const scale = isActive ? 1 : 0.8;
            const opacity = isActive ? 1 : Math.abs(offset) <= 1 ? 0.7 : 0.3;
            const zIndex = isActive ? 10 : Math.abs(offset) <= 1 ? 5 : 1;

            return (
              <div
                key={prize.id}
                className="absolute w-80 h-96 md:w-96 md:h-[480px] cursor-pointer transition-all duration-700 ease-out"
                style={{
                  transform: `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                  opacity,
                  zIndex,
                  transformStyle: 'preserve-3d',
                  willChange: 'transform, opacity', // Optimize for animations
                  backfaceVisibility: 'hidden' // Prevent flickering
                }}
                onClick={() => goToSlide(index)}
              >
                {/* Prize Card */}
                <div className={`w-full h-full relative rounded-3xl overflow-hidden shadow-2xl transition-all duration-500 ${isMobile ? 'bg-slate-800/90' : 'glass-card hover:shadow-3xl'}`}>
                  {/* Background Gradient */}
                  <div 
                    className="absolute inset-0 bg-gradient-to-br opacity-20"
                    style={{
                      background: `linear-gradient(135deg, ${prize.color}40, ${prize.color}10)`
                    }}
                  ></div>
                  
                  {/* Card Content */}
                  <div className="relative z-10 p-6 md:p-8 h-full flex flex-col">
                    {/* Prize Icon */}
                    <div className="flex-shrink-0 mb-6">
                      <div className="relative w-32 h-32 md:w-40 md:h-40 mx-auto">
                        <div className={`absolute inset-0 rounded-full bg-gradient-to-br from-white/20 to-transparent border border-white/30 shadow-xl ${isMobile ? '' : 'backdrop-blur-sm'}`}>
                          {/* Rotating Ring with GPU acceleration - Desktop Only */}
                          {isActive && !isMobile && (
                            <div 
                              className="absolute inset-2 border border-white/20 rounded-full animate-spin" 
                              style={{
                                animationDuration: '20s',
                                transform: 'translateZ(0)', // Force GPU acceleration
                                willChange: 'transform'
                              }}
                            ></div>
                          )}
                          
                          {/* Icon with lazy loading */}
                          <div className="absolute inset-6 flex items-center justify-center">
                            <LazyImage
                              src={prize.icon}
                              alt={prize.name}
                              width={80}
                              height={80}
                              className="w-full h-full object-contain filter drop-shadow-lg"
                              {...(isActive ? { priority: true } : { placeholder: "blur", quality: 75 })}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Prize Info */}
                    <div className="flex-grow text-center space-y-4">
                      <div className="space-y-2">
                        <h3 className="text-xl md:text-2xl font-bold text-white">
                          {prize.name}
                        </h3>
                        <p className="text-lg md:text-xl font-semibold" style={{ color: prize.color }}>
                          {prize.value}
                        </p>
                      </div>
                      
                      <p className="text-sm md:text-base text-gray-300 leading-relaxed">
                        {prize.description}
                      </p>

                      {/* Features */}
                      <div className="space-y-2">
                        {prize.features.slice(0, 2).map((feature, idx) => (
                          <div key={idx} className="flex items-center justify-center gap-2 text-xs md:text-sm text-gray-400">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                            {feature}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Play Button */}
                    <div className="flex-shrink-0 mt-6">
                      <Link
                        href="/quizzes"
                        className={`block w-full py-3 px-6 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl text-white font-semibold text-center transition-all duration-300 shadow-lg touch-manipulation ${!isMobile ? 'hover:from-blue-700 hover:to-purple-700 transform hover:scale-105 hover:shadow-xl' : ''}`}
                      >
                        Play to Win
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Navigation Arrows */}
        <button
          onClick={prevSlide}
          className={`absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 w-12 h-12 md:w-16 md:h-16 rounded-full transition-all duration-300 flex items-center justify-center group touch-manipulation ${isMobile ? 'bg-slate-800/90' : 'glass-card hover:glass-card-hover'}`}
          aria-label="Previous prize"
        >
          <svg className={`w-6 h-6 md:w-8 md:h-8 text-white transition-colors ${!isMobile ? 'group-hover:text-blue-400' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          onClick={nextSlide}
          className={`absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 w-12 h-12 md:w-16 md:h-16 rounded-full transition-all duration-300 flex items-center justify-center group touch-manipulation ${isMobile ? 'bg-slate-800/90' : 'glass-card hover:glass-card-hover'}`}
          aria-label="Next prize"
        >
          <svg className={`w-6 h-6 md:w-8 md:h-8 text-white transition-colors ${!isMobile ? 'group-hover:text-blue-400' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Dots Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex gap-3">
          {prizes.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className={`w-3 h-3 rounded-full transition-all duration-300 touch-manipulation ${
                index === currentIndex 
                  ? 'bg-blue-400 scale-125' 
                  : `bg-white/40 ${!isMobile ? 'hover:bg-white/60' : ''}`
              }`}
              aria-label={`Go to prize ${index + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Current Prize Details */}
      <div className="mt-12 text-center max-w-4xl mx-auto">
        <div className={`rounded-2xl p-6 md:p-8 ${isMobile ? 'bg-slate-800/90' : 'glass-card'}`}>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
            {prizes[currentIndex].name}
          </h2>
          <p className="text-lg text-gray-300 mb-6">
            {prizes[currentIndex].description}
          </p>
          
          {/* All Features */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {prizes[currentIndex].features.map((feature, index) => (
              <div key={index} className="flex items-center gap-2 text-sm text-gray-400">
                <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0"></div>
                {feature}
              </div>
            ))}
          </div>

          <Link
              href="/quizzes"
              className={`inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl text-white font-semibold transition-all duration-300 shadow-lg touch-manipulation ${!isMobile ? 'hover:from-blue-700 hover:to-purple-700 transform hover:scale-105 hover:shadow-xl' : ''}`}
            >
            Start Playing Now
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PrizesPage() {
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white">
      {/* Background Effects - Desktop Only */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {!isMobile && (
          <>
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
            <div className="absolute top-3/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
            <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-500"></div>
          </>
        )}
      </div>
      
      {/* Simplified Background for Mobile */}
      {isMobile && (
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-blue-500/5 rounded-full"></div>
          <div className="absolute top-3/4 right-1/4 w-32 h-32 bg-purple-500/5 rounded-full"></div>
          <div className="absolute top-1/2 left-1/2 w-32 h-32 bg-cyan-500/5 rounded-full"></div>
        </div>
      )}

      {/* Hero Section */}
      <section className="relative py-12 md:py-20 lg:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="text-center mb-12 md:mb-16 space-y-6">
            <div className={`inline-block px-6 py-3 rounded-full text-base font-medium ${isMobile ? 'bg-slate-800/90' : 'glass-card'}`}>
              🏆 Amazing Prizes Await
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black leading-tight">
              Win <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">Incredible</span> Prizes
            </h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
              Test your knowledge and win amazing prizes! From motorcycles to smartphones, 
              we have incredible rewards waiting for our quiz champions.
            </p>
          </div>

          {/* 3D Coverflow Slider */}
          <CoverflowSlider isMobile={isMobile} />
        </div>
      </section>

      {/* How to Win Section */}
      <section className="relative py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`rounded-3xl p-8 md:p-12 ${isMobile ? 'bg-slate-800/90' : 'glass-card'}`}>
            <div className="text-center mb-12 space-y-4">
              <h2 className="text-3xl md:text-5xl font-bold">
                How to <span className="text-green-400">Win</span>
              </h2>
              <p className="text-lg text-gray-300 max-w-2xl mx-auto">
                Follow these simple steps to participate and win amazing prizes
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
              {[
                {
                  step: '01',
                  title: 'Choose Quiz',
                  description: 'Select from our variety of quiz categories',
                  icon: '🎯',
                  color: '#3b82f6'
                },
                {
                  step: '02',
                  title: 'Answer Questions',
                  description: 'Answer all questions correctly within time limit',
                  icon: '🧠',
                  color: '#10b981'
                },
                {
                  step: '03',
                  title: 'Score High',
                  description: 'Achieve the minimum required score to qualify',
                  icon: '⭐',
                  color: '#f59e0b'
                },
                {
                  step: '04',
                  title: 'Win Prize',
                  description: 'Get your prize delivered to your doorstep',
                  icon: '🎁',
                  color: '#ef4444'
                }
              ].map((item, index) => (
                <div 
                  key={index}
                  className="relative group"
                >
                  <div className={`rounded-2xl p-6 h-full transition-all duration-300 touch-manipulation ${isMobile ? 'bg-slate-700/50' : 'glass-card hover:scale-105 hover:shadow-2xl'}`}>
                    <div className="text-center space-y-4">
                      <div className="relative">
                        <div 
                          className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center text-2xl mb-2 ${!isMobile ? 'group-hover:scale-110' : ''} transition-transform duration-300`}
                          style={{ backgroundColor: `${item.color}20`, border: `2px solid ${item.color}40` }}
                        >
                          {item.icon}
                        </div>
                        <div 
                          className="absolute -top-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: item.color }}
                        >
                          {item.step}
                        </div>
                      </div>
                      <h3 className="text-xl font-bold text-white">{item.title}</h3>
                      <p className="text-sm text-gray-400 leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-center">
              <Link
                href="/quizzes"
                className={`inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-green-600 to-blue-600 rounded-xl text-white font-semibold text-lg transition-all duration-300 shadow-lg touch-manipulation ${!isMobile ? 'hover:from-green-700 hover:to-blue-700 transform hover:scale-105 hover:shadow-xl' : ''}`}
              >
                Start Playing Now
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="relative py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {[
              { label: 'Total Prizes', value: '4+', icon: '🏆' },
              { label: 'Prize Value', value: '290K+', icon: '💰' },
              { label: 'Winners', value: '150+', icon: '🎉' },
              { label: 'Active Quizzes', value: '25+', icon: '📚' }
            ].map((stat, index) => (
              <div key={index} className={`rounded-2xl p-6 text-center group transition-all duration-300 touch-manipulation ${isMobile ? 'bg-slate-800/90' : 'glass-card hover:scale-105'}`}>
                <div className="text-3xl mb-2">{stat.icon}</div>
                <div className="text-2xl md:text-3xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-sm text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}