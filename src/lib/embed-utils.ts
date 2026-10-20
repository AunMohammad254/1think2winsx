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
  // watch?v=, also with other parameters first (watch?app=desktop&v=...)
  /youtube\.com\/watch\?(?:[^"'\s#]*&)?v=([a-zA-Z0-9_-]+)/,
  // embed/ on either player domain; "live_stream" is a channel's live stream, not a video id
  /youtube(?:-nocookie)?\.com\/embed\/(?!live_stream\b)([a-zA-Z0-9_-]+)/,
  /youtube\.com\/live\/([a-zA-Z0-9_-]+)/,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/,
  /youtu\.be\/([a-zA-Z0-9_-]+)/,
  /youtube\.com\/v\/([a-zA-Z0-9_-]+)/,
];

/** A channel's current live stream (embed/live_stream?channel=UC...), which has no video id. */
const YOUTUBE_CHANNEL_LIVE = /youtube(?:-nocookie)?\.com\/embed\/live_stream\?(?:[^"'\s#]*&)?channel=([a-zA-Z0-9_-]+)/;

/**
 * How the live stream's YouTube player behaves:
 *  - fs=0: no fullscreen button. The player's own fullscreen covers the quiz pop-ups, so the page's
 *    fullscreen button is the only one (StreamPlayer also leaves `fullscreen` out of `allow`).
 *  - playsinline=1: iPhones play it in the page instead of their own full-screen player.
 *  - rel=0: suggestions at the end come from the same channel. iv_load_policy=3: no annotations.
 */
const YOUTUBE_PLAYER_PARAMS = 'autoplay=1&playsinline=1&fs=0&rel=0&iv_load_policy=3';

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
  return lower.includes('youtube.com') || lower.includes('youtu.be') || lower.includes('youtube-nocookie.com');
}

/**
 * The live stream's player URL for any YouTube link or embed code the admin pastes: a video, a live
 * stream, a Short, or a channel's current live stream. Always our own parameters (above), whatever
 * the pasted code asked for. Null when it is not YouTube or names nothing to play.
 */
export function youTubeEmbedUrl(input: string): string | null {
  if (!isYouTubeContent(input)) return null;
  const channel = input.match(YOUTUBE_CHANNEL_LIVE)?.[1];
  if (channel) return `https://www.youtube.com/embed/live_stream?channel=${channel}&${YOUTUBE_PLAYER_PARAMS}`;
  const videoId = getYouTubeVideoId(input);
  return videoId ? `https://www.youtube.com/embed/${videoId}?${YOUTUBE_PLAYER_PARAMS}` : null;
}

// ============================================================================
// Embed HTML builders
// ============================================================================

/**
 * Admin embed code with the player's own fullscreen switched off, for the same reason as `fs=0`:
 * - no `allowfullscreen` (or vendor-prefixed) attribute, and no `fullscreen` in an `allow` list;
 * - Facebook's video plugin is told `allowfullscreen=false`, which hides its button;
 * - a `<video>` gets no fullscreen button (`controlslist`) and plays inline on iPhones.
 */
export function withoutEmbedFullscreen(html: string): string {
  return html
    .replace(/\s(?:webkit|moz)?allowfullscreen(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '')
    .replace(/(\sallow\s*=\s*)(["'])([^"']*)\2/gi, (_match, attr: string, quote: string, list: string) => {
      const kept = list.split(';').map((feature) => feature.trim()).filter((feature) => feature && !/^fullscreen\b/i.test(feature));
      return `${attr}${quote}${kept.join('; ')}${quote}`;
    })
    .replace(/([?&](?:amp;)?allowfullscreen=)true/gi, '$1false')
    .replace(/<video\b(?![^>]*controlslist)/gi, '<video playsinline controlslist="nofullscreen"');
}

/**
 * Converts admin-provided embed HTML/URL into a self-contained HTML document
 * suitable for use as an iframe `src` data URI.
 *
 * Handles:
 * - Raw YouTube video/live/Short URLs → the live stream's YouTube player
 * - Existing YouTube iframes with watch URLs → converts src to embed URL
 * - All other embed HTML → wraps in a responsive full-viewport document
 * In every case the embed's own fullscreen is switched off (`withoutEmbedFullscreen`).
 */
export function buildResponsiveEmbedDocument(rawHtml: string): string {
  let processedHtml = rawHtml;

  if (isYouTubeContent(rawHtml)) {
    if (!rawHtml.includes('<iframe')) {
      // Plain YouTube URL — convert to embed iframe
      const playerUrl = youTubeEmbedUrl(rawHtml);
      if (playerUrl) {
        processedHtml = `<iframe src="${playerUrl}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
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
    <div class="wrapper">${withoutEmbedFullscreen(processedHtml)}</div>
  </body></html>`;
}

/**
 * Returns the data URI string to use as an iframe's `src` attribute.
 * Pass the raw admin-provided embed HTML or URL.
 */
export function buildEmbedDataUri(rawHtml: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildResponsiveEmbedDocument(rawHtml))}`;
}
