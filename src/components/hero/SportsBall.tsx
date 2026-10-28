export type SportsBallType = 'cricket' | 'basketball' | 'tennis' | 'football' | 'hockey' | 'squash';

interface SportsBallProps {
  className?: string;
  type?: SportsBallType;
}

interface BallStyleConfig {
  name: string;
  image: string;
  glow: string;
  shadow: string;
}

const BALL_CONFIGS: Record<SportsBallType, BallStyleConfig> = {
  cricket: {
    name: 'Cricket Ball',
    image: '/images/sports/cricket.webp',
    glow: 'radial-gradient(circle, rgba(239, 68, 68, 0.45) 0%, rgba(185, 28, 28, 0.18) 50%, transparent 72%)',
    shadow: 'rgba(185, 28, 28, 0.45)',
  },
  football: {
    name: 'Football',
    image: '/images/sports/football.webp',
    glow: 'radial-gradient(circle, rgba(255, 255, 255, 0.38) 0%, rgba(56, 189, 248, 0.2) 50%, transparent 72%)',
    shadow: 'rgba(56, 189, 248, 0.35)',
  },
  hockey: {
    name: 'Field Hockey Ball',
    image: '/images/sports/hockey.webp',
    glow: 'radial-gradient(circle, rgba(254, 240, 138, 0.4) 0%, rgba(245, 158, 11, 0.18) 50%, transparent 72%)',
    shadow: 'rgba(245, 158, 11, 0.35)',
  },
  squash: {
    name: 'Squash Ball',
    image: '/images/sports/squash.webp',
    glow: 'radial-gradient(circle, rgba(250, 204, 21, 0.4) 0%, rgba(100, 116, 139, 0.18) 50%, transparent 72%)',
    shadow: 'rgba(250, 204, 21, 0.3)',
  },
  tennis: {
    name: 'Tennis Ball',
    image: '/images/sports/tennis.webp',
    glow: 'radial-gradient(circle, rgba(163, 230, 53, 0.45) 0%, rgba(132, 204, 22, 0.2) 50%, transparent 72%)',
    shadow: 'rgba(132, 204, 22, 0.4)',
  },
  basketball: {
    name: 'Basketball',
    image: '/images/sports/basketball.webp',
    glow: 'radial-gradient(circle, rgba(249, 115, 22, 0.45) 0%, rgba(194, 65, 12, 0.2) 50%, transparent 72%)',
    shadow: 'rgba(234, 88, 12, 0.4)',
  },
};

/**
 * Widths of the pre-sized AVIF copies next to each picture (scripts/resize-sports-images.ts makes them).
 * They are plain static files, so Cloudflare caches them; Next's optimizer (/_next/image) resized every
 * visitor's copy on Hostinger, because Cloudflare never caches that route.
 */
export const SPORTS_BALL_WIDTHS = [128, 256, 384, 512];
const SPORTS_BALL_SIZES = '(max-width: 640px) 96px, (max-width: 1024px) 160px, 240px';

/** `/images/sports/cricket.webp` → `/images/sports/cricket-128.avif 128w, …` */
export function sportsBallSrcSet(image: string): string {
  return SPORTS_BALL_WIDTHS.map((width) => `${image.replace(/\.webp$/, `-${width}.avif`)} ${width}w`).join(', ');
}

export function SportsBall({ className = "", type = "cricket" }: SportsBallProps) {
  const config = BALL_CONFIGS[type] || BALL_CONFIGS.cricket;

  return (
    <div
      // Default sizes only apply when the caller supplies none: the responsive defaults
      // (md:/lg:) would otherwise beat a caller's `w-full h-full` and blow the ball up to 320px.
      className={`ball-enter group relative transition-transform duration-500 ease-out hover:scale-110 cursor-pointer ${
        className || 'w-48 h-48 md:w-64 md:h-64 lg:w-80 lg:h-80'
      }`}
    >
      {/* Dynamic ambient colored glow */}
      <div
        className="absolute -inset-2 rounded-full blur-2xl opacity-60 transition-opacity duration-500 group-hover:opacity-90 animate-pulse pointer-events-none"
        style={{
          background: config.glow,
          animationDuration: '4s',
        }}
        aria-hidden="true"
      />

      {/* Realistic volumetric drop shadow underneath ball */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          boxShadow: `0 20px 45px -10px ${config.shadow}, 0 28px 60px -15px rgba(0, 0, 0, 0.75)`,
        }}
        aria-hidden="true"
      />

      {/* Main 3D ball container */}
      <div className="ball-spin relative w-full h-full rounded-full overflow-hidden select-none">
        {/* The original 512px WebP is the fallback for a browser without AVIF */}
        <picture>
          <source type="image/avif" srcSet={sportsBallSrcSet(config.image)} sizes={SPORTS_BALL_SIZES} />
          {/* eslint-disable-next-line @next/next/no-img-element -- static files on purpose, see SPORTS_BALL_WIDTHS */}
          <img
            src={config.image}
            alt={config.name}
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full object-contain pointer-events-none drop-shadow-2xl"
          />
        </picture>

        {/* Specular glass sheen overlay */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none opacity-40 mix-blend-overlay transition-opacity duration-300 group-hover:opacity-60"
          style={{
            background: 'radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.1) 40%, transparent 65%)',
          }}
          aria-hidden="true"
        />

        {/* Fine spherical depth rim highlight */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none border border-white/10"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
