/**
 * Shared stream/embed utilities
 *
 * Extracted from VideoPlayer.tsx and StreamPlayer.tsx to avoid duplicating
 * YouTube detection, URL extraction, and iframe document wrapping logic.
 */

// ============================================================================
// YouTube helpers
// ============================================================================

const YOUTUBE_PATTERNS = [
  /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/,
  /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
  /youtube\.com\/live\/([a-zA-Z0-9_-]+)/,
  /youtu\.be\/([a-zA-Z0-9_-]+)/,
  /youtube\.com\/v\/([a-zA-Z0-9_-]+)/,
];

/** Returns the YouTube video ID from any YouTube URL or embed HTML, or null. */
export function getYouTubeVideoId(input: string): string | null {
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** Returns true if the string contains a YouTube URL or embed. */
export function isYouTubeContent(input: string): boolean {
  const lower = input.toLowerCase();
  return lower.includes('youtube.com') || lower.includes('youtu.be');
}

// ============================================================================
// Embed HTML builders
// ============================================================================

/**
 * Converts admin-provided embed HTML/URL into a self-contained HTML document
 * suitable for use as an iframe `src` data URI.
 *
 * Handles:
 * - Raw YouTube watch/live/short URLs → embedded iframe
 * - Existing YouTube iframes with watch URLs → converts src to embed URL
 * - All other embed HTML → wraps in a responsive full-viewport document
 */
export function buildResponsiveEmbedDocument(rawHtml: string): string {
  let processedHtml = rawHtml;

  if (isYouTubeContent(rawHtml)) {
    if (!rawHtml.includes('<iframe')) {
      // Plain YouTube URL — convert to embed iframe
      const videoId = getYouTubeVideoId(rawHtml);
      if (videoId) {
        processedHtml = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
      }
    } else {
      // Existing iframe — normalise watch/live URLs to embed URLs
      processedHtml = rawHtml
        .replace(/src="https?:\/\/(?:www\.)?youtube\.com\/watch\?v=/g, 'src="https://www.youtube.com/embed/')
        .replace(/src="https?:\/\/youtu\.be\//g, 'src="https://www.youtube.com/embed/')
        .replace(/src="https?:\/\/(?:www\.)?youtube\.com\/live\//g, 'src="https://www.youtube.com/embed/');
    }
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { height: 100%; margin: 0; padding: 0; background: #000; overflow: hidden; }
      .wrapper { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
      iframe, video { width: 100% !important; height: 100% !important; border: 0; }
      .wrapper > * { max-width: 100%; max-height: 100%; }
      @media (orientation: portrait) { .wrapper { padding: 0; } }
    </style>
  </head><body>
    <div class="wrapper">${processedHtml}</div>
  </body></html>`;
}

/**
 * Returns the data URI string to use as an iframe's `src` attribute.
 * Pass the raw admin-provided embed HTML or URL.
 */
export function buildEmbedDataUri(rawHtml: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildResponsiveEmbedDocument(rawHtml))}`;
}
