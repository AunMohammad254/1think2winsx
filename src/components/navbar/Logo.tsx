'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export default function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-3">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative"
      >
        {/* Logo Icon Container */}
        <div className="relative w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 p-0.5 shadow-lg shadow-purple-500/25 group-hover:shadow-purple-500/40 transition-shadow duration-300">
          <div className="w-full h-full rounded-[10px] bg-black/80 backdrop-blur-sm flex items-center justify-center">
            {/* Stylized "1T" Logo */}
            <span className="text-lg md:text-xl font-black bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent font-montserrat">
              1T
            </span>
          </div>
        </div>
        
        {/* Glow effect on hover */}
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 opacity-0 group-hover:opacity-30 blur-xl transition-opacity duration-300" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
        className="hidden sm:block"
      >
        <h1 className="text-lg md:text-xl font-bold font-montserrat leading-tight">
          <span className="bg-gradient-to-r from-white via-blue-100 to-purple-200 bg-clip-text text-transparent">
            1Think
          </span>
          <span className="ml-1 text-white/90">2Win</span>
        </h1>
        <p className="text-[10px] md:text-xs text-white/50 font-medium tracking-wider uppercase -mt-0.5">
          Cricket Excellence
        </p>
      </motion.div>
    </Link>
  );
}
