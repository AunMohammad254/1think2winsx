/**
 * How the live stream is shown fullscreen. StreamPlayer sets this attribute on its fullscreen target
 * while it is fullscreen: "native" through the Fullscreen API, or "immersive" when the browser can't
 * put a page element in fullscreen (iPhone Safari) and the stream fills the window with CSS instead.
 * live-quiz.css styles both the same way, and the quiz pop-ups read it to pick their layout.
 */
export const STREAM_FULLSCREEN_ATTR = 'data-stream-fullscreen';

export type StreamFullscreenMode = 'native' | 'immersive';

/** True while the live stream is fullscreen, either way. */
export function isStreamFullscreen(): boolean {
  return document.querySelector(`[${STREAM_FULLSCREEN_ATTR}]`) !== null;
}
