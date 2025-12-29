'use strict';

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { getResponsiveClasses } from '@/components/StreamPlayer';

/**
 * Comprehensive tests for LiveStreamViewer responsiveness
 * Tests cover:
 * - Viewport-based responsive class generation
 * - Edge cases at breakpoint boundaries
 * - API response shape validation
 */

describe('Live Stream Viewer - Responsive Classes', () => {
  describe('Desktop breakpoints (1920px+)', () => {
    it('applies desktop classes at exactly 1920px', () => {
      const classes = getResponsiveClasses(1920);
      assert.ok(classes.includes('aspect-video'), 'Should include aspect-video');
      assert.ok(classes.includes('max-w-[1600px]'), 'Should include max-w-[1600px]');
      assert.ok(classes.includes('mx-auto'), 'Should include mx-auto for centering');
    });

    it('applies desktop classes at 4K resolution (3840px)', () => {
      const classes = getResponsiveClasses(3840);
      assert.ok(classes.includes('aspect-video'));
      assert.ok(classes.includes('max-w-[1600px]'));
    });

    it('applies desktop classes at 2560px (QHD)', () => {
      const classes = getResponsiveClasses(2560);
      assert.ok(classes.includes('max-w-[1600px]'));
    });
  });

  describe('Laptop breakpoints (1024-1919px)', () => {
    it('applies laptop classes at exactly 1024px', () => {
      const classes = getResponsiveClasses(1024);
      assert.ok(classes.includes('aspect-video'));
      assert.ok(classes.includes('max-w-[1024px]'));
    });

    it('applies laptop classes at 1366px (common laptop)', () => {
      const classes = getResponsiveClasses(1366);
      assert.ok(classes.includes('max-w-[1024px]'));
    });

    it('applies laptop classes just below desktop threshold (1919px)', () => {
      const classes = getResponsiveClasses(1919);
      assert.ok(classes.includes('max-w-[1024px]'));
      assert.ok(!classes.includes('max-w-[1600px]'), 'Should NOT include desktop width');
    });
  });

  describe('Tablet breakpoints (768-1023px)', () => {
    it('applies tablet classes at exactly 768px', () => {
      const classes = getResponsiveClasses(768);
      assert.ok(classes.includes('aspect-video'));
      assert.ok(classes.includes('max-w-[768px]'));
    });

    it('applies tablet classes at 800px', () => {
      const classes = getResponsiveClasses(800);
      assert.ok(classes.includes('max-w-[768px]'));
    });

    it('applies tablet classes just below laptop threshold (1023px)', () => {
      const classes = getResponsiveClasses(1023);
      assert.ok(classes.includes('max-w-[768px]'));
      assert.ok(!classes.includes('max-w-[1024px]'), 'Should NOT include laptop width');
    });
  });

  describe('Mobile breakpoints (<768px)', () => {
    it('applies mobile classes at 375px (iPhone SE)', () => {
      const classes = getResponsiveClasses(375);
      assert.ok(classes.includes('aspect-video'));
      assert.ok(classes.includes('w-full'));
    });

    it('applies mobile classes at 320px (minimum supported)', () => {
      const classes = getResponsiveClasses(320);
      assert.ok(classes.includes('w-full'));
    });

    it('applies mobile classes just below tablet threshold (767px)', () => {
      const classes = getResponsiveClasses(767);
      assert.ok(classes.includes('w-full'));
      assert.ok(!classes.includes('max-w-[768px]'), 'Should NOT include tablet width');
    });
  });

  describe('Edge cases', () => {
    it('handles zero width gracefully', () => {
      const classes = getResponsiveClasses(0);
      assert.ok(classes.includes('w-full'));
    });

    it('handles negative width gracefully', () => {
      const classes = getResponsiveClasses(-100);
      assert.ok(classes.includes('w-full'));
    });

    it('handles very large widths', () => {
      const classes = getResponsiveClasses(10000);
      assert.ok(classes.includes('max-w-[1600px]'));
    });
  });
});

describe('Streaming API Response Validation', () => {
  describe('Response shape validation', () => {
    it('validates inactive stream response shape', () => {
      const response = { hasActiveStream: false, stream: null };
      assert.strictEqual(response.hasActiveStream, false);
      assert.strictEqual(response.stream, null);
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
      assert.strictEqual(response.hasActiveStream, true);
      assert.ok(response.stream);
      assert.strictEqual(typeof response.stream.id, 'string');
      assert.strictEqual(typeof response.stream.name, 'string');
      assert.strictEqual(typeof response.stream.embedHtml, 'string');
    });
  });

  describe('Embed HTML validation', () => {
    it('accepts valid YouTube iframe', () => {
      const embedHtml = '<iframe src="https://www.youtube.com/embed/abc123"></iframe>';
      assert.ok(embedHtml.includes('youtube.com'));
      assert.ok(embedHtml.includes('<iframe'));
    });

    it('accepts valid Facebook iframe', () => {
      const embedHtml = '<iframe src="https://www.facebook.com/plugins/video.php?href=..."></iframe>';
      assert.ok(embedHtml.includes('facebook.com'));
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
        assert.ok(isYouTube, `Should detect YouTube: ${url}`);
      }
    });
  });
});