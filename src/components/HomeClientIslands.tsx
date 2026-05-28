'use client';

import React, { memo, useState, useRef, useEffect } from 'react';
import { motion, useInView, Variants } from 'framer-motion';

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 60, scale: 0.95 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, delay: delay * 0.15, ease: [0.0, 0.0, 0.2, 1] as const }
  })
};

import { UserPlus, BrainCircuit, Trophy, Bike, Smartphone, Headphones, Watch } from 'lucide-react';

const iconMap: Record<string, React.ElementType> = {
  UserPlus,
  BrainCircuit,
  Trophy,
  Bike,
  Smartphone,
  Headphones,
  Watch
};

export function CountUp({ end, suffix = '', duration = 2 }: { end: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (!isInView) return;
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [isInView, end, duration]);

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

export const StepCard = memo(({ title, description, gradient, delay, icon }: {
  title: string;
  description: string;
  gradient: string;
  delay: number;
  icon: string;
}) => {
  const Icon = iconMap[icon] || Trophy;
  return (
    <motion.div
      className="group relative"
      variants={cardVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
      custom={delay}
      whileHover={{ y: -8, scale: 1.03 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <motion.div
        className={`absolute inset-0 ${gradient} rounded-3xl blur-xl transition-all duration-500`}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        transition={{ delay: delay * 0.15 + 0.3 }}
      />
      <div className="relative glass-card-blue p-8 rounded-3xl border border-blue-400/20 shadow-2xl">
        <div className="text-center space-y-6">
          <div className="relative mx-auto w-20 h-20 mb-6">
            <motion.div
              className="relative w-full h-full bg-white rounded-2xl flex items-center justify-center shadow-xl"
              whileHover={{ rotate: 12 }}
              transition={{ type: "spring", stiffness: 200 }}
            >
              <Icon className="w-10 h-10 text-blue-600" />
            </motion.div>
          </div>
          <h3 className="text-2xl font-bold text-white mb-4">{title}</h3>
          <p className="text-gray-300 leading-relaxed" dangerouslySetInnerHTML={{ __html: description }} />
        </div>
      </div>
    </motion.div>
  );
});
StepCard.displayName = 'StepCard';

export const PrizeCard = memo(({ icon, title, description, gradient, badge, delay }: {
  icon: string;
  title: string;
  description: string;
  gradient: string;
  badge: string;
  delay: number;
}) => {
  const Icon = iconMap[icon] || Trophy;
  return (
    <motion.div
      className="group relative"
      variants={cardVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
      custom={delay}
      whileHover={{ y: -12, scale: 1.04 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <motion.div
        className={`absolute inset-0 ${gradient} rounded-3xl blur-xl transition-all duration-500`}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        transition={{ delay: delay * 0.15 + 0.3 }}
      />
      <div className="relative glass-card-blue p-6 rounded-3xl border border-red-400/20 shadow-2xl">
        <div className="text-center space-y-4">
          <div className="relative mx-auto w-24 h-24 mb-4">
            <motion.div
              className="relative w-full h-full bg-white rounded-2xl flex items-center justify-center shadow-xl"
              whileHover={{ rotate: 12 }}
              transition={{ type: "spring", stiffness: 200 }}
            >
              <Icon className="w-12 h-12 text-blue-600" />
            </motion.div>
          </div>
          <h3 className="text-2xl font-bold text-white">{title}</h3>
          <p className="text-gray-300 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: description }} />
          <div className="pt-2">
            <motion.span
              className={`inline-block px-4 py-2 ${gradient} rounded-full text-orange-300 text-sm font-semibold border border-orange-400/30`}
              whileHover={{ scale: 1.1 }}
              transition={{ type: "spring", stiffness: 400 }}
            >
              {badge}
            </motion.span>
          </div>
        </div>
      </div>
    </motion.div>
  );
});
PrizeCard.displayName = 'PrizeCard';

export const StatCard = memo(({ end, suffix, display, label, color }: {
  end: number | null;
  suffix?: string;
  display?: string;
  label: string;
  color: string;
}) => (
  <motion.div
    className="group"
    initial={{ opacity: 0, y: 30, scale: 0.9 }}
    whileInView={{ opacity: 1, y: 0, scale: 1 }}
    viewport={{ once: true }}
    transition={{ duration: 0.5 }}
    whileHover={{ scale: 1.06 }}
  >
    <div className={`glass-card-blue p-4 rounded-2xl border ${color} touch-manipulation`}>
      <div className={`text-2xl md:text-3xl font-black ${color.replace('border-', 'text-').replace('/20', '')} mb-1`}>
        {display || <CountUp end={end!} suffix={suffix} />}
      </div>
      <div className="text-sm text-gray-300">{label}</div>
    </div>
  </motion.div>
));
StatCard.displayName = 'StatCard';

export function ConnectorLine() {
  return (
    <motion.div
      className="hidden md:block absolute top-[45%] left-[15%] right-[15%] h-px z-0"
      initial={{ scaleX: 0, opacity: 0 }}
      whileInView={{ scaleX: 1, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 1, delay: 0.3 }}
      style={{ transformOrigin: 'center' }}
    >
      <div className="w-full h-full bg-gradient-to-r from-transparent via-blue-400/30 via-purple-400/30 to-transparent" />
    </motion.div>
  );
}

export function AnimatedCTA({ children }: { children: React.ReactNode }) {
  const sectionVariants: Variants = {
    hidden: { opacity: 0, y: 40 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: [0.0, 0.0, 0.2, 1] as const }
    }
  };
  return (
    <motion.div
      className="max-w-4xl mx-auto space-y-8"
      variants={sectionVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedHeader({ children }: { children: React.ReactNode }) {
  const sectionVariants: Variants = {
    hidden: { opacity: 0, y: 40 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: [0.0, 0.0, 0.2, 1] as const }
    }
  };
  return (
    <motion.div
      className="text-center mb-16"
      variants={sectionVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
    >
      {children}
    </motion.div>
  );
}
