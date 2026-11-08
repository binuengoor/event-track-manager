// Fade-out ramp and gain stage. Clock/scheduler injectable.
export const FADE_MS = 3000;

export function createFader({
  setLevel, duration = FADE_MS, onDone = () => {},
  now = () => Date.now(),
  schedule = fn => setTimeout(fn, 30), cancelSchedule = h => clearTimeout(h),
}) {
  let startedAt = null;
  let handle = null;
  let from = 1;

  function tick() {
    if (startedAt === null) return;
    const t = Math.min(1, (now() - startedAt) / duration);
    setLevel(from * (1 - t));
    if (t >= 1) {
      startedAt = null;
      handle = null;
      onDone();
      return;
    }
    handle = schedule(tick);
  }

  return {
    get active() { return startedAt !== null; },
    start(fromLevel = 1) {
      if (startedAt !== null) return false;
      from = fromLevel;
      startedAt = now();
      handle = schedule(tick);
      return true;
    },
    // Abort without calling onDone; caller restores the level.
    cancel() {
      if (startedAt === null) return;
      startedAt = null;
      if (handle !== null) cancelSchedule(handle);
      handle = null;
    },
  };
}

// GainNode between the media element and the speakers. Returns null if unsupported.
export function createGainStage(mediaElement, AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext) {
  if (!mediaElement || !AudioContextCtor) return null;
  try {
    const ctx = new AudioContextCtor();
    const source = ctx.createMediaElementSource(mediaElement);
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(ctx.destination);
    let base = 1;   // per-track loudness gain (can boost above 1)
    let level = 1;  // fade level, 0..1
    const apply = () => { gain.gain.value = base * level; };
    return {
      ctx,
      gain,
      setGain(v) { level = Math.max(0, Math.min(1, v)); apply(); },
      setBase(v) { base = Number.isFinite(v) && v > 0 ? v : 1; apply(); },
      resume() { return ctx.state === 'suspended' ? ctx.resume() : Promise.resolve(); },
    };
  } catch (e) {
    return null;
  }
}
