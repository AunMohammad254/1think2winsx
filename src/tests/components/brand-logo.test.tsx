import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import BrandLogo, { logoLoader, LOGO_SIZES, LOGO_WIDTHS } from '@/components/brand/Logo';
import Logo from '@/components/navbar/Logo';

const copy = (width: number) => logoLoader({ src: '/images/brand/logo-1024.png', width });

describe('BrandLogo', () => {
  it('picks the smallest pre-sized copy that is wide enough, and the largest past that', () => {
    expect(copy(48)).toBe('/images/brand/logo-64.webp');
    expect(copy(64)).toBe('/images/brand/logo-64.webp');
    expect(copy(96)).toBe('/images/brand/logo-128.webp');
    expect(copy(3840)).toBe('/images/brand/logo-512.webp');
  });

  it('every copy the loader can pick, and the source, are in public/', () => {
    for (const path of [...LOGO_WIDTHS.map(copy), '/images/brand/logo-1024.png']) {
      expect(existsSync(join(process.cwd(), 'public', path)), path).toBe(true);
    }
  });

  it('serves the static copies at 1x and 2x, lazily by default', () => {
    render(<BrandLogo />);
    const img = screen.getByRole('img', { name: '1Think 2Win' });
    expect(img).toHaveAttribute('width', String(LOGO_SIZES.sm));
    expect(img).toHaveAttribute('srcset', '/images/brand/logo-64.webp 1x, /images/brand/logo-128.webp 2x');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img.className).toBe('rounded-full');
  });

  it('takes a size, extra classes, an empty alt beside the wordmark, and eager loading', () => {
    const { container } = render(<BrandLogo size="lg" alt="" className="shadow-xl" eager />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('width', String(LOGO_SIZES.lg));
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img.className).toBe('rounded-full shadow-xl');
  });
});

describe('navbar Logo', () => {
  it('links home with the brain mark, loaded straight away, next to the wordmark', () => {
    render(<Logo />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/');
    expect(within(link).getByRole('img', { name: '1Think 2Win' })).toHaveAttribute('loading', 'eager');
    expect(link).toHaveTextContent('1Think2Win');
  });
});
