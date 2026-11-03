'use client';

import Image, { type ImageLoader } from 'next/image';

/**
 * Widths of the pre-sized copies in public/images/brand (scripts/generate-brand-assets.ts makes them).
 * They are plain static files, so Cloudflare caches them; Next's optimizer (/_next/image) would resize
 * the logo on Hostinger for every visitor, because Cloudflare never caches that route.
 */
export const LOGO_WIDTHS = [64, 128, 256, 512];

/** The smallest pre-sized copy at least `width` pixels wide (the largest one past that). */
export const logoLoader: ImageLoader = ({ width }) =>
    `/images/brand/logo-${LOGO_WIDTHS.find((w) => w >= width) ?? LOGO_WIDTHS[LOGO_WIDTHS.length - 1]}.webp`;

/** Rendered size in CSS pixels. A className with its own h-/w- classes can still resize it responsively. */
export const LOGO_SIZES = { sm: 48, md: 80, lg: 100 } as const;

export type LogoSize = keyof typeof LOGO_SIZES;

interface BrandLogoProps {
    size?: LogoSize;
    className?: string;
    /** Pass "" where the "1Think 2Win" wordmark is always shown next to it, so screen readers don't say it twice */
    alt?: string;
    /** Above the fold on every page (the navbar): load it straight away */
    eager?: boolean;
}

/** The 1Think 2Win brain mark: the one logo the whole site uses. */
export default function BrandLogo({ size = 'sm', className = '', alt = '1Think 2Win', eager }: BrandLogoProps) {
    const px = LOGO_SIZES[size];
    return (
        <Image
            loader={logoLoader}
            src="/images/brand/logo-1024.png"
            alt={alt}
            width={px}
            height={px}
            loading={eager ? 'eager' : undefined}
            className={`rounded-full ${className}`.trim()}
        />
    );
}
