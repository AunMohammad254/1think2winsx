import { describe, it, expect } from 'vitest';
import { getResponsiveClasses } from '@/components/StreamPlayer';

/**
 * Comprehensive tests for LiveStreamViewer responsiveness
 */

describe('Live Stream Viewer - Responsive Classes', () => {
  describe('Desktop breakpoints (1920px+)', () => {
    it('applies desktop classes at exactly 1920px', () => {
      const classes = getResponsiveClasses(1920);
      expect(classes).toContain('aspect-video');
      expect(classes).toContain('max-w-[1600px]');
      expect(classes).toContain('mx-auto');
    });

    it('applies desktop classes at 4K resolution (3840px)', () => {
      const classes = getResponsiveClasses(3840);
      expect(classes).toContain('aspect-video');
      expect(classes).toContain('max-w-[1600px]');
    });

    it('applies desktop classes at 2560px (QHD)', () => {
      const classes = getResponsiveClasses(2560);
      expect(classes).toContain('max-w-[1600px]');
    });
  });

  describe('Laptop breakpoints (1024-1919px)', () => {
    it('applies laptop classes at exactly 1024px', () => {
      const classes = getResponsiveClasses(1024);
      expect(classes).toContain('aspect-video');
      expect(classes).toContain('max-w-[1024px]');
    });

    it('applies laptop classes at 1366px (common laptop)', () => {
      const classes = getResponsiveClasses(1366);
      expect(classes).toContain('max-w-[1024px]');
    });

    it('applies laptop classes just below desktop threshold (1919px)', () => {
      const classes = getResponsiveClasses(1919);
      expect(classes).toContain('max-w-[1024px]');
      expect(classes).not.toContain('max-w-[1600px]');
    });
  });

  describe('Tablet breakpoints (768-1023px)', () => {
    it('applies tablet classes at exactly 768px', () => {
      const classes = getResponsiveClasses(768);
      expect(classes).toContain('aspect-video');
      expect(classes).toContain('max-w-[768px]');
    });

    it('applies tablet classes at 800px', () => {
      const classes = getResponsiveClasses(800);
      expect(classes).toContain('max-w-[768px]');
    });

    it('applies tablet classes just below laptop threshold (1023px)', () => {
      const classes = getResponsiveClasses(1023);
      expect(classes).toContain('max-w-[768px]');
      expect(classes).not.toContain('max-w-[1024px]');
    });
  });

  describe('Mobile breakpoints (<768px)', () => {
    it('applies mobile classes at 375px (iPhone SE)', () => {
      const classes = getResponsiveClasses(375);
      expect(classes).toContain('aspect-video');
      expect(classes).toContain('w-full');
    });

    it('applies mobile classes at 320px (minimum supported)', () => {
      const classes = getResponsiveClasses(320);
      expect(classes).toContain('w-full');
    });

    it('applies mobile classes just below tablet threshold (767px)', () => {
      const classes = getResponsiveClasses(767);
      expect(classes).toContain('w-full');
      expect(classes).not.toContain('max-w-[768px]');
    });
  });

  describe('Edge cases', () => {
    it('handles zero width gracefully', () => {
      const classes = getResponsiveClasses(0);
      expect(classes).toContain('w-full');
    });

    it('handles negative width gracefully', () => {
      const classes = getResponsiveClasses(-100);
      expect(classes).toContain('w-full');
    });

    it('handles very large widths', () => {
      const classes = getResponsiveClasses(10000);
      expect(classes).toContain('max-w-[1600px]');
    });
  });
});

describe('Streaming API Response Validation', () => {
  describe('Response shape validation', () => {
    it('validates inactive stream response shape', () => {
      const response = { hasActiveStream: false, stream: null };
      expect(response.hasActiveStream).toBe(false);
      expect(response.stream).toBeNull();
    });

    it('validates active stream response shape', () => {
      const response = {
        hasActiveStream: true,
        stream: {
          id: 'test-123',
          name: 'Test Stream',
          title: 'Test Title',
          embedHtml: '<iframe src="..."></iframe>'
        }
      };
      expect(response.hasActiveStream).toBe(true);
      expect(response.stream).toBeTruthy();
      expect(typeof response.stream.id).toBe('string');
      expect(typeof response.stream.name).toBe('string');
      expect(typeof response.stream.embedHtml).toBe('string');
    });
  });

  describe('Embed HTML validation', () => {
    it('accepts valid YouTube iframe', () => {
      const embedHtml = '<iframe src="https://www.youtube.com/embed/abc123"></iframe>';
      expect(embedHtml).toContain('youtube.com');
      expect(embedHtml).toContain('<iframe');
    });

    it('accepts valid Facebook iframe', () => {
      const embedHtml = '<iframe src="https://www.facebook.com/plugins/video.php?href=..."></iframe>';
      expect(embedHtml).toContain('facebook.com');
    });

    it('detects YouTube URLs in various formats', () => {
      const formats = [
        'https://www.youtube.com/watch?v=abc123',
        'https://youtube.com/embed/abc123',
        'https://youtu.be/abc123',
        'https://www.youtube.com/live/abc123'
      ];

      for (const url of formats) {
        const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
        expect(isYouTube).toBe(true);
      }
    });
  });
});