// Hostinger's build server reports 64 CPUs but limits how many threads an account may start. By
// default `next build` runs one worker per CPU (63), and each loads the Rust compiler with a thread
// pool per CPU; on 2026-10-19 that ran out ("OS can't spawn worker thread", build 01a15397).
// Four build workers (experimental.cpus below), each with a small Rust pool, stay far below the limit.
// Set here so the build workers inherit it; an explicit value from the environment still wins.
process.env.TOKIO_WORKER_THREADS ??= '4';

const fs = require('fs');
const path = require('path');
const { withSentryConfig } = require('@sentry/nextjs/config');

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

/**
 * The Sentry release (which build an error came from): SENTRY_RELEASE if set, otherwise the commit
 * scripts/build-hostinger.ps1 stamps into `.sentry-release` (the Hostinger zip has no .git). Undefined
 * locally, where Sentry's plugin reads the commit from git itself.
 */
function sentryRelease() {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  try {
    return fs.readFileSync(path.join(__dirname, '.sentry-release'), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

/** remotePatterns entry for this project's public Supabase Storage files (none if the URL is unset). */
function supabaseStoragePatterns() {
  try {
    const { hostname } = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    return [{ protocol: 'https', hostname, port: '', pathname: '/storage/v1/object/public/**' }];
  } catch {
    return [];
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for Docker deployments
  // Creates a minimal production bundle at .next/standalone
  output: 'standalone',

  // Security configurations
  poweredByHeader: false, // Remove X-Powered-By header
  // `next dev` prints every Server Action call with its arguments, which put sign-in passwords in
  // the terminal. Production never logs them; this stops it in development too.
  logging: {
    serverFunctions: false,
  },
  // `next dev` only: lets a phone on the same home network open the dev server by its LAN address
  // (http://192.168.x.y:3000) with hot reload working. Each `*` matches one part of the address,
  // so it keeps working when the router hands this machine a new one. Ignored by `next build`.
  allowedDevOrigins: ['192.168.*.*'],

  // Compression
  compress: true,

  // Mobile performance optimizations
  experimental: {
    // optimizeCss needs the `critters` package (not installed) and broke builds before
    optimizePackageImports: ['framer-motion'],
    // Build workers; see TOKIO_WORKER_THREADS at the top
    cpus: 4,
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
      },
      {
        // Browsers fetch the manifest on most page loads, and public files get max-age=0, so each fetch
        // reached Hostinger. A day is fine: it changes about never, and browsers re-read it after that.
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400'
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
      // Supabase Storage media buckets. Images there are stored pre-sized and use the loader in
      // src/lib/media/config.ts; this entry only covers an <Image> rendered without it.
      ...supabaseStoragePatterns(),
    ],
    unoptimized: false,
    // Image formats and sizes
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  }
};

// Sentry (src/instrumentation*.ts, src/sentry.*.config.ts). Still a plain object, as Hostinger needs.
module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), {
  org: process.env.SENTRY_ORG || '1think2win',
  project: process.env.SENTRY_PROJECT,
  // Readable stack traces: with SENTRY_AUTH_TOKEN set (hPanel, secret) the build uploads source maps to
  // Sentry and then deletes them. Without it none are made at all, so the site never serves them.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  widenClientFileUpload: true,
  release: { name: sentryRelease() },
  // No `tunnelRoute`: browsers send events to this site's own route, src/app/monitoring/route.ts, which
  // forwards them. Sentry's rewrite printed a MaxListenersExceededWarning for every event.
  silent: !process.env.CI,
  telemetry: false,
  webpack: {
    treeshake: { removeDebugLogging: true },
  },
});