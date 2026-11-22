export type FeedbackTone = 'scan' | 'success' | 'return' | 'error';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startOffset: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.18
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
  gain.gain.setValueAtTime(volume, ctx.currentTime + startOffset);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + startOffset);
  osc.stop(ctx.currentTime + startOffset + duration);
}

function triggerVibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore unsupported environments
    }
  }
}

export function playFeedback(tone: FeedbackTone): void {
  const ctx = getAudioContext();

  switch (tone) {
    case 'scan':
      triggerVibrate(45);
      if (ctx) playTone(ctx, 980, 0, 0.09, 'sine', 0.16);
      break;
    case 'success':
      triggerVibrate([60, 40, 80]);
      if (ctx) {
        playTone(ctx, 660, 0, 0.11, 'sine', 0.18);
        playTone(ctx, 880, 0.11, 0.16, 'sine', 0.18);
      }
      break;
    case 'return':
      triggerVibrate([50, 35, 90]);
      if (ctx) {
        playTone(ctx, 784, 0, 0.1, 'triangle', 0.18);
        playTone(ctx, 1046, 0.1, 0.16, 'triangle', 0.18);
      }
      break;
    case 'error':
      triggerVibrate([160, 80, 220]);
      if (ctx) {
        playTone(ctx, 220, 0, 0.18, 'sawtooth', 0.18);
        playTone(ctx, 175, 0.2, 0.28, 'sawtooth', 0.2);
      }
      break;
  }
}
