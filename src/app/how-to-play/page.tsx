'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { motion, useScroll, useTransform } from 'framer-motion';
import {
  UserPlus,
  Search,
  CreditCard,
  HelpCircle,
  Trophy,
  Bike,
  Smartphone,
  Headphones,
  Watch,
  Sparkles,
  ChevronDown,
  Zap,
  ArrowRight,
  Crown
} from 'lucide-react';

// Components
import StepCard from '@/components/how-to-play/StepCard';
import PrizeCard from '@/components/how-to-play/PrizeCard';
import RulesTabs from '@/components/how-to-play/RulesTabs';
import WinningTips from '@/components/how-to-play/WinningTips';
import FAQAccordion from '@/components/how-to-play/FAQAccordion';

// Step Data
const steps = [
  { step: 1, title: "Register", description: "Create your free account in seconds", icon: UserPlus },
  { step: 2, title: "Browse Quizzes", description: "Find exciting cricket challenges", icon: Search },
  { step: 3, title: "Pay 2 PKR", description: "Tiny fee, huge winning potential", icon: CreditCard },
  { step: 4, title: "Answer", description: "Complete within 10 minutes", icon: HelpCircle },
  { step: 5, title: "Win Big!", description: "Get randomly selected for prizes", icon: Trophy },
];

// Prize Data
const prizes = [
  { name: "CD 70 Bike", description: "Honda CD 70 Motorcycle - Your ticket to freedom!", icon: Bike, tier: 'grand' as const, value: "Worth ₨55,000+" },
  { name: "Smartphone", description: "Latest Android phone with all modern features", icon: Smartphone, tier: 'major' as const },
  { name: "Wireless Earbuds", description: "Premium Bluetooth earbuds for music lovers", icon: Headphones, tier: 'standard' as const },
  { name: "Smart Watch", description: "Fitness tracker with all the bells and whistles", icon: Watch, tier: 'standard' as const },
];

// Animation Variants
const fadeInUp = {
  initial: { opacity: 0, y: 40 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1
    }
  }
};

export default function HowToPlayPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.15], [1, 0.95]);

  const scrollToSteps = () => {
    stepsRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div ref={containerRef} className="min-h-screen bg-slate-950 overflow-hidden">
      {/* Hero Section */}
      <motion.section
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative min-h-[90vh] sm:min-h-screen flex items-center justify-center overflow-hidden"
      >
        {/* Animated Background */}
        <div className="absolute inset-0">
          {/* Base Gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-950 via-slate-900 to-blue-950" />

          {/* Cricket Field Pattern - Subtle Overlay */}
          <div className="absolute inset-0 opacity-[0.03]">
            <div className="absolute inset-0" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2316a34a' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }} />
          </div>

          {/* Animated Orbs */}
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl"
          />
          <motion.div
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.2, 0.4, 0.2],
            }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="absolute -bottom-40 -left-40 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl"
          />
          <motion.div
            animate={{
              scale: [1, 1.15, 1],
              opacity: [0.15, 0.3, 0.15],
            }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 2 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-3xl"
          />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 mb-6 sm:mb-8"
          >
            <Crown className="w-4 h-4 text-amber-400" />
            <span className="text-emerald-300 text-sm font-medium">Pakistan&apos;s #1 Cricket Quiz Platform</span>
            <Sparkles className="w-4 h-4 text-amber-400" />
          </motion.div>

          {/* Main Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold mb-4 sm:mb-6 font-[family-name:var(--font-poppins)] leading-tight"
          >
            <span className="text-white">How to Play</span>
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
              & Win Big
            </span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg sm:text-xl md:text-2xl text-gray-400 max-w-3xl mx-auto mb-8 sm:mb-12 leading-relaxed"
          >
            Join the ultimate cricket quiz. Test your knowledge, top the leaderboard,
            and win <span className="text-amber-400 font-semibold">real prizes</span> worth thousands!
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <motion.button
              onClick={scrollToSteps}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="relative group px-8 py-4 rounded-xl font-semibold text-white overflow-hidden"
            >
              {/* Pulsating Glow */}
              <motion.div
                animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-0 bg-gradient-to-r from-emerald-600 to-teal-500 rounded-xl blur-md"
              />
              <span className="relative z-10 flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-500 px-8 py-4 rounded-xl -m-[1px]">
                <Zap className="w-5 h-5" />
                Get Started
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </span>
            </motion.button>

            <Link href="/quizzes">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-8 py-4 rounded-xl font-semibold text-white border border-white/20 bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-colors flex items-center gap-2"
              >
                Browse Quizzes
              </motion.button>
            </Link>
          </motion.div>
        </div>

        {/* Scroll Indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            onClick={scrollToSteps}
            className="cursor-pointer p-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
          >
            <ChevronDown className="w-6 h-6 text-white/50" />
          </motion.div>
        </motion.div>
      </motion.section>

      {/* 5-Step Journey Section */}
      <section ref={stepsRef} className="relative py-16 sm:py-24 lg:py-32 px-4 sm:px-6">
        {/* Section Background */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" />

        <div className="relative z-10 max-w-7xl mx-auto">
          {/* Section Header */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12 sm:mb-16"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium mb-4">
              Quick Start Guide
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 font-[family-name:var(--font-poppins)]">
              Your 5-Step <span className="text-emerald-400">Winning</span> Journey
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              From registration to winning prizes - it&apos;s as easy as hitting a six!
            </p>
          </motion.div>

          {/* Steps Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6 lg:gap-8">
            {steps.map((step, index) => (
              <StepCard
                key={step.step}
                step={step.step}
                title={step.title}
                description={step.description}
                icon={step.icon}
                delay={index * 0.1}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Prize Showcase Section */}
      <section className="relative py-16 sm:py-24 lg:py-32 px-4 sm:px-6">
        {/* Background Gradient */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-emerald-950/20 to-slate-950" />
          <motion.div
            animate={{ opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 5, repeat: Infinity }}
            className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1/2 bg-gradient-to-b from-amber-500/10 to-transparent"
          />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto">
          {/* Section Header */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12 sm:mb-16"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-medium mb-4">
              🏆 Amazing Rewards
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 font-[family-name:var(--font-poppins)]">
              Win <span className="bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">Incredible</span> Prizes
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Every completed quiz is your chance to win. Just 2 PKR could change your life!
            </p>
          </motion.div>

          {/* Prize Grid - Bento Style */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {prizes.map((prize, index) => (
              <PrizeCard
                key={prize.name}
                name={prize.name}
                description={prize.description}
                icon={prize.icon}
                tier={prize.tier}
                value={prize.value}
                delay={index * 0.15}
              />
            ))}
          </div>

          {/* View All Prizes Link */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-8 sm:mt-12"
          >
            <Link href="/prizes">
              <motion.span
                whileHover={{ scale: 1.05 }}
                className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 font-semibold transition-colors"
              >
                View All Prizes
                <ArrowRight className="w-4 h-4" />
              </motion.span>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Rules & Guidelines Section */}
      <section className="relative py-16 sm:py-24 lg:py-32 px-4 sm:px-6">
        <div className="absolute inset-0 bg-slate-950" />

        <div className="relative z-10 max-w-5xl mx-auto">
          {/* Section Header */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12 sm:mb-16"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm font-medium mb-4">
              Know the Rules
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 font-[family-name:var(--font-poppins)]">
              Rules & <span className="text-emerald-400">Guidelines</span>
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Everything you need to know about quizzes, payments, and scoring.
            </p>
          </motion.div>

          {/* Rules Tabs Component */}
          <RulesTabs />
        </div>
      </section>

      {/* Winning Tips Section */}
      <section className="relative py-16 sm:py-24 lg:py-32 px-4 sm:px-6">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" />

        <div className="relative z-10 max-w-6xl mx-auto">
          {/* Section Header */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12 sm:mb-16"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/30 text-teal-400 text-sm font-medium mb-4">
              💡 Pro Tips
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 font-[family-name:var(--font-poppins)]">
              Tips to <span className="text-emerald-400">Maximize</span> Your Wins
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Follow these expert strategies to boost your performance.
            </p>
          </motion.div>

          {/* Tips Component */}
          <WinningTips />
        </div>
      </section>

      {/* FAQ Section */}
      <section className="relative py-16 sm:py-24 lg:py-32 px-4 sm:px-6">
        <div className="absolute inset-0 bg-slate-950" />

        <div className="relative z-10 max-w-4xl mx-auto">
          {/* Section Header */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12 sm:mb-16"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-sm font-medium mb-4">
              ❓ Got Questions?
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 font-[family-name:var(--font-poppins)]">
              Frequently Asked <span className="text-emerald-400">Questions</span>
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Quick answers to the most common questions about playing and winning.
            </p>
          </motion.div>

          {/* FAQ Accordion Component */}
          <FAQAccordion />

          {/* More FAQs Link */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-8 sm:mt-12"
          >
            <Link href="/faq">
              <motion.span
                whileHover={{ scale: 1.05 }}
                className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 font-semibold transition-colors"
              >
                View All FAQs
                <ArrowRight className="w-4 h-4" />
              </motion.span>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="relative py-16 sm:py-24 lg:py-32 px-4 sm:px-6 overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950 via-slate-900 to-blue-950" />

        {/* Animated Decorative Elements */}
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.15, 0.3, 0.15],
          }}
          transition={{ duration: 6, repeat: Infinity }}
          className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/30 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.1, 0.2, 0.1],
          }}
          transition={{ duration: 8, repeat: Infinity, delay: 1 }}
          className="absolute bottom-0 left-0 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl"
        />

        <div className="relative z-10 max-w-4xl mx-auto text-center">
          {/* Trophy Icon */}
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="relative inline-block mb-8"
          >
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 4, repeat: Infinity }}
            >
              <div className="relative w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 p-1 shadow-xl shadow-amber-500/30">
                <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center">
                  <Trophy className="w-12 h-12 sm:w-16 sm:h-16 text-amber-400" strokeWidth={1.5} />
                </div>
              </div>
            </motion.div>
            <motion.div
              animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute inset-0 bg-amber-500/20 rounded-full blur-xl"
            />
          </motion.div>

          {/* Headline */}
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-white mb-4 sm:mb-6 font-[family-name:var(--font-poppins)]"
          >
            Ready to <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">Smash It?</span>
          </motion.h2>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto mb-8 sm:mb-12"
          >
            Join thousands of cricket fans competing for amazing prizes.
            Your next win could be just <span className="text-amber-400 font-semibold">one quiz</span> away!
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link href="/quizzes">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="group px-8 py-4 rounded-xl font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-500 shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transition-shadow flex items-center gap-2"
              >
                <Search className="w-5 h-5" />
                Browse Quizzes
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </motion.button>
            </Link>

            <Link href="/register">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="group px-8 py-4 rounded-xl font-bold text-white border-2 border-white/20 bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-colors flex items-center gap-2"
              >
                <UserPlus className="w-5 h-5" />
                Register Now
              </motion.button>
            </Link>
          </motion.div>

          {/* Trust Badges */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            className="mt-12 flex flex-wrap items-center justify-center gap-6 sm:gap-8 text-gray-400 text-sm"
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Secure Payments</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Real Prizes</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span>Fair Play Guaranteed</span>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}