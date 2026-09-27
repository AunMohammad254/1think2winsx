import { describe, it, expect } from 'vitest';
import { 
    detectPlatform, 
    convertYouTubeToEmbed, 
    validateEmbed, 
    sanitizeEmbed, 
    processEmbed 
} from '../utils/streaming-utils';

describe('streaming-utils', () => {
    describe('detectPlatform', () => {
        it('should detect YouTube URLs', () => {
            expect(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
            expect(detectPlatform('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
            expect(detectPlatform('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>')).toBe('youtube');
        });

        it('should detect Facebook URLs', () => {
            expect(detectPlatform('https://www.facebook.com/facebook/videos/123456789/')).toBe('facebook');
            expect(detectPlatform('https://fb.watch/abcd/')).toBe('facebook');
        });

        it('should detect Twitch URLs', () => {
            expect(detectPlatform('https://www.twitch.tv/username')).toBe('twitch');
            expect(detectPlatform('https://player.twitch.tv/?channel=username')).toBe('twitch');
        });

        it('should return custom for unknown platforms', () => {
            expect(detectPlatform('https://vimeo.com/123456')).toBe('custom');
            expect(detectPlatform('<video src="test.mp4"></video>')).toBe('custom');
        });
    });

    describe('convertYouTubeToEmbed', () => {
        it('should convert watch URLs', () => {
            const input = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
            const output = convertYouTubeToEmbed(input);
            expect(output).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
            expect(output).toContain('<iframe');
        });

        it('should convert short URLs', () => {
            const input = 'https://youtu.be/dQw4w9WgXcQ';
            const output = convertYouTubeToEmbed(input);
            expect(output).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
        });

        it('should convert live URLs', () => {
            const input = 'https://www.youtube.com/live/dQw4w9WgXcQ';
            const output = convertYouTubeToEmbed(input);
            expect(output).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
        });

        it('should fix existing iframes with watch URLs', () => {
            const input = '<iframe src="https://www.youtube.com/watch?v=dQw4w9WgXcQ"></iframe>';
            const output = convertYouTubeToEmbed(input);
            expect(output).toBe('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>');
        });

        it('should return original string if not a YouTube URL', () => {
            const input = 'https://vimeo.com/123456';
            expect(convertYouTubeToEmbed(input)).toBe(input);
        });
    });

    describe('validateEmbed', () => {
        it('should return invalid for short strings', () => {
            expect(validateEmbed('abc').valid).toBe(false);
        });

        it('should return invalid for script tags', () => {
            const result = validateEmbed('<script>alert("xss")</script>');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('Script tags');
        });

        it('should return valid for iframes', () => {
            expect(validateEmbed('<iframe src="test"></iframe>').valid).toBe(true);
        });

        it('should return valid for known platform URLs', () => {
            expect(validateEmbed('https://www.youtube.com/watch?v=123').valid).toBe(true);
        });

        it('should return valid for generic URLs', () => {
            expect(validateEmbed('https://example.com/stream').valid).toBe(true);
        });

        it('should return invalid for random text without tags or URLs', () => {
            expect(validateEmbed('This is just some random text').valid).toBe(false);
        });
    });

    describe('sanitizeEmbed', () => {
        it('should remove script tags', () => {
            const input = '<div><script>alert(1)</script><iframe></iframe></div>';
            const output = sanitizeEmbed(input);
            expect(output).not.toContain('<script>');
            expect(output).toContain('<iframe>');
        });

        it('should trim whitespace', () => {
            expect(sanitizeEmbed('  <div></div>  ')).toBe('<div></div>');
        });
    });

    describe('processEmbed', () => {
        it('should process YouTube URLs', () => {
            const input = 'https://www.youtube.com/watch?v=123';
            expect(processEmbed(input)).toContain('https://www.youtube.com/embed/123');
        });

        it('should sanitize non-YouTube custom embeds', () => {
            const input = '<video src="test.mp4"></video><script>alert(1)</script>';
            const output = processEmbed(input);
            expect(output).toBe('<video src="test.mp4"></video>');
        });
    });
});
