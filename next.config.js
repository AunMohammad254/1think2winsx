const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for Docker deployments
  // Creates a minimal production bundle at .next/standalone
  output: 'standalone',

  // Security configurations
  poweredByHeader: false, // Remove X-Powered-By header

  // Compression
  compress: true,

  // Mobile performance optimizations
  experimental: {
    // optimizeCss needs the `critters` package (not installed) and broke builds before
    optimizePackageImports: ['framer-motion'],
  },
  serverExternalPackages: ['pdf-parse'],

  // Compiler optimizations
  compiler: {
    // Remove console.log/info/debug in production, but KEEP console.error and console.warn:
    // they are the only record of failed pushes/emails, RPC errors and the [SECURITY EVENT]
    // sink, and stripping them leaves nothing to look at during an incident.
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },

  // Modular imports for better tree-shaking
  modularizeImports: {
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{kebabCase member}}',
    },
    'date-fns': {
      transform: 'date-fns/{{member}}',
    }
  },
  // Security headers (additional to middleware)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()'
          }
        ]
      }
    ];
  },

  // Redirect HTTP to HTTPS in production
  async redirects() {
    if (process.env.NODE_ENV === 'production') {
      return [
        {
          source: '/(.*)',
          has: [
            {
              type: 'header',
              key: 'x-forwarded-proto',
              value: 'http'
            }
          ],
          destination: 'https://:host/:path*',
          permanent: true
        }
      ];
    }
    return [];
  },

  // Environment variables validation
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },

  // Image optimization security - completely restrict external images
  images: {
    dangerouslyAllowSVG: false,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    // Responsive image configuration
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.pakwheels.com',
        port: '',
        pathname: '/**',
      },
      {
        // Cloudinary (prize images and videos). Most <Image>s use the Cloudinary loader
        // in src/lib/cloudinary.ts; this entry covers any that go through Next's optimizer.
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        port: '',
        pathname: `/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dszrz6s6u'}/**`,
      },
    ],
    unoptimized: false,
    // Image formats and sizes
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  }
};

module.exports = withBundleAnalyzer(nextConfig);