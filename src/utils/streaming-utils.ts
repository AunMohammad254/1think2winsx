/**
 * Streaming Utilities
 * Helper functions for stream embed processing
 */

/**
 * Auto-detects the streaming platform from embed code or URL.
 */
export function detectPlatform(embedCode: string): 'youtube' | 'facebook' | 'twitch' | 'custom' {
    const lower = embedCode.toLowerCase();

    if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
        return 'youtube';
    }
    if (lower.includes('facebook.com') || lower.includes('fb.watch')) {
        return 'facebook';
    }
    if (lower.includes('twitch.tv') || lower.includes('player.twitch.tv')) {
        return 'twitch';
    }

    return 'custom';
}

/**
 * Validates embed HTML content
 */
export function validateEmbed(html: string): { valid: boolean; message: string } {
    if (!html || html.trim().length < 10) {
        return { valid: false, message: 'Enter at least 10 characters' };
    }

    const hasValidTag = /<(iframe|video|embed|object|blockquote)/i.test(html);
    const hasScriptTag = /<script/i.test(html);

    if (hasScriptTag) {
        return { valid: false, message: 'Script tags are not allowed' };
    }

    if (!hasValidTag) {
        // Check if it might be a URL
        try {
            const url = new URL(html.trim());
            if (['http:', 'https:'].includes(url.protocol)) {
                return { valid: true, message: 'Valid URL detected' };
            }
        } catch {
            // Not a URL
        }
        return { valid: false, message: 'Must contain iframe, video, or embed tag' };
    }

    return { valid: true, message: 'Valid embed code' };
}

/**
 * Sanitizes embed HTML by removing script tags
 */
export function sanitizeEmbed(html: string): string {
    return html.trim().replace(/<script[^>]*>.*?<\/script>/gis, '');
}
