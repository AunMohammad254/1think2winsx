import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SportsBall, SPORTS_BALL_WIDTHS, sportsBallSrcSet } from './SportsBall';

describe('SportsBall component and utilities', () => {
  describe('SPORTS_BALL_WIDTHS', () => {
    it('exports the correct array of widths for avif copies', () => {
      expect(SPORTS_BALL_WIDTHS).toEqual([128, 256, 384, 512]);
    });
  });

  describe('sportsBallSrcSet', () => {
    it('generates the correct srcSet string for a given webp image', () => {
      const srcSet = sportsBallSrcSet('/images/sports/cricket.webp');
      expect(srcSet).toBe(
        '/images/sports/cricket-128.avif 128w, /images/sports/cricket-256.avif 256w, /images/sports/cricket-384.avif 384w, /images/sports/cricket-512.avif 512w'
      );
    });

    it('generates the correct srcSet string for another sport webp image', () => {
      const srcSet = sportsBallSrcSet('/images/sports/basketball.webp');
      expect(srcSet).toBe(
        '/images/sports/basketball-128.avif 128w, /images/sports/basketball-256.avif 256w, /images/sports/basketball-384.avif 384w, /images/sports/basketball-512.avif 512w'
      );
    });
  });

  describe('SportsBall component', () => {
    it('renders the default cricket ball when no props are provided', () => {
      const { container } = render(<SportsBall />);

      const img = screen.getByAltText('Cricket Ball');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', '/images/sports/cricket.webp');

      const source = container.querySelector('source');
      expect(source).toBeInTheDocument();
      expect(source).toHaveAttribute('type', 'image/avif');
      expect(source).toHaveAttribute(
        'srcSet',
        '/images/sports/cricket-128.avif 128w, /images/sports/cricket-256.avif 256w, /images/sports/cricket-384.avif 384w, /images/sports/cricket-512.avif 512w'
      );
    });

    it('renders a specific sport ball when type is provided', () => {
      render(<SportsBall type="basketball" />);

      const img = screen.getByAltText('Basketball');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', '/images/sports/basketball.webp');
    });

    it('applies custom className when provided', () => {
      const { container } = render(<SportsBall className="custom-class" />);

      const rootDiv = container.firstChild as HTMLElement;
      expect(rootDiv).toHaveClass('custom-class');
      expect(rootDiv).not.toHaveClass('w-48'); // Default classes shouldn't be applied
    });

    it('falls back to default cricket ball if invalid type is somehow provided', () => {
      // TypeScript would prevent this, but simulating it for runtime behavior
      // @ts-expect-error - testing invalid type fallback
      render(<SportsBall type="invalid_sport" />);

      const img = screen.getByAltText('Cricket Ball');
      expect(img).toBeInTheDocument();
    });
  });
});
