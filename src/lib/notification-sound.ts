/**
 * The notification chime and the bell's sound setting, shared by the bell (useNotifications) and the
 * live stream's quiz pop-ups, which follow the same setting.
 */

/** localStorage key of the bell's sound toggle. */
export const SOUND_SETTING_KEY = 'notifications_sound_enabled';

/** The bell's sound setting: on unless the player turned it off (or storage is blocked). */
export function isNotificationSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_SETTING_KEY) !== 'false';
  } catch {
    return true;
  }
}

// Module-level AudioContext singleton — browsers cap concurrent AudioContext
// instances (typically at 6). Reusing one instance prevents resource exhaustion.
let _audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    _audioCtx = new AudioContextClass();
  }
  return _audioCtx;
}

// Function to play a premium chime sound synthesized on the fly via Web Audio API.
// Reuses the module-level AudioContext singleton to avoid browser resource limits.
export function playChime() {
  try {
    const audioCtx = getAudioContext();
    if (!audioCtx) return;

    // Resume context if it was suspended by browser autoplay policy
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
      return;
    }

    const playTone = (freq: number, start: number, duration: number) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gainNode.gain.setValueAtTime(0.12, start);
      gainNode.gain.exponentialRampToValueAtTime(0.001, start + duration);

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start(start);
      osc.stop(start + duration);
    };

    const now = audioCtx.currentTime;
    // Premium soft double chime: C5 followed shortly by E5
    playTone(523.25, now, 0.15);        // C5
    playTone(659.25, now + 0.08, 0.25); // E5
  } catch (err) {
    console.error('AudioContext chime failed', err);
  }
}
