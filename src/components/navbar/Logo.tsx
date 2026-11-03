import Link from 'next/link';
import BrandLogo from '@/components/brand/Logo';

export default function Logo({ prefetch }: { prefetch?: false }) {
  return (
    <Link href="/" prefetch={prefetch} className="group flex items-center gap-3">
      <div className="logo-mark-enter relative">
        {/* Glow effect on hover */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 opacity-0 group-hover:opacity-30 blur-xl transition-opacity duration-300" />

        <BrandLogo eager className="relative w-10 h-10 md:w-12 md:h-12 shadow-lg shadow-purple-500/25 group-hover:shadow-purple-500/40 transition-shadow duration-300" />
      </div>

      <div className="logo-text-enter hidden sm:block">
        <h1 className="text-lg md:text-xl font-bold font-poppins leading-tight">
          <span className="bg-gradient-to-r from-white via-blue-100 to-purple-200 bg-clip-text text-transparent">
            1Think
          </span>
          <span className="ml-1 text-white/90">2Win</span>
        </h1>
        <p className="text-[10px] md:text-xs text-white/50 font-medium tracking-wider uppercase -mt-0.5">
          Sports Excellence
        </p>
      </div>
    </Link>
  );
}
