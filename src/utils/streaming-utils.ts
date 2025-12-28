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
 * Converts a YouTube URL to an embed iframe
 * Supports: watch URLs, live URLs, short URLs, and embed URLs
 */
export function convertYouTubeToEmbed(input: string): string {
    const lower = input.toLowerCase();

    // Check if it's actually a YouTube link
    if (!lower.includes('youtube.com') && !lower.includes('youtu.be')) {
        return input;
    }

    // If it's already an iframe, just fix the URL format
    if (input.includes('<iframe')) {
        return input
            .replace(/src="https?:\/\/(?:www\.)?youtube\.com\/watch\?v=/g, 'src="https://www.youtube.com/embed/')
            .replace(/src="https?:\/\/youtu\.be\//g, 'src="https://www.youtube.com/embed/')
            .replace(/src="https?:\/\/(?:www\.)?youtube\.com\/live\//g, 'src="https://www.youtube.com/embed/');
    }

    // Extract video ID from various URL formats
    const patterns = [
        /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
        /youtube\.com\/live\/([a-zA-Z0-9_-]+)/,
        /youtu\.be\/([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match) {
            const videoId = match[1];
            return `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="width:100%;height:100%;"></iframe>`;
        }
    }

    return input;
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
                // Check if it's a known streaming platform URL
                const platform = detectPlatform(html);
                if (platform !== 'custom') {
                    return { valid: true, message: `Valid ${platform.charAt(0).toUpperCase() + platform.slice(1)} URL detected` };
                }
                return { valid: true, message: 'Valid URL detected' };
            }
        } catch {
            // Not a URL
        }
        return { valid: false, message: 'Must contain iframe, video, or embed tag, or a valid streaming URL' };
    }

    return { valid: true, message: 'Valid embed code' };
}

/**
 * Sanitizes embed HTML by removing script tags
 */
export function sanitizeEmbed(html: string): string {
    return html.trim().replace(/<script[^>]*>.*?<\/script>/gis, '');
}

/**
 * Processes any embed code/URL to a renderable format
 * Handles YouTube, Facebook, Twitch URLs and converts them to proper iframes
 */
export function processEmbed(input: string): string {
    const platform = detectPlatform(input);

    switch (platform) {
        case 'youtube':
            return convertYouTubeToEmbed(input);
        // Add more platform handlers here as needed
        default:
            return sanitizeEmbed(input);
    }
}
