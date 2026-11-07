// Press-and-hold confirmation with a progress fill. Timer/clock are injectable for tests.
export function createHoldConfirm({
  duration = 1000, onProgress = () => {}, onConfirm = () => {}, onCancel = () => {},
  now = () => Date.now(),
  schedule = fn => setTimeout(fn, 16), cancelSchedule = h => clearTimeout(h),
} = {}) {
  let startedAt = null;
  let handle = null;

  function tick() {
    if (startedAt === null) return;
    const progress = Math.min(1, (now() - startedAt) / duration);
    onProgress(progress);
    if (progress >= 1) {
      startedAt = null;
      handle = null;
      onConfirm();
      return;
    }
    handle = schedule(tick);
  }

  return {
    get active() { return startedAt !== null; },
    start() {
      if (startedAt !== null) return;
      startedAt = now();
      onProgress(0);
      handle = schedule(tick);
    },
    cancel() {
      if (startedAt === null) return;
      startedAt = null;
      if (handle !== null) cancelSchedule(handle);
      handle = null;
      onProgress(0);
      onCancel();
    },
  };
}

// Wire a button: pointer hold or keyboard Enter hold. A plain click never confirms.
// When enabled() is false (for example the button is in Undo mode) the button behaves natively.
export function bindHoldButton(button, controller, {enabled = () => true} = {}) {
  const stop = () => controller.cancel();
  button.addEventListener('pointerdown', e => {
    if (enabled() && (e.button === 0 || e.button === undefined)) controller.start();
  });
  ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(t => button.addEventListener(t, stop));
  button.addEventListener('keydown', e => {
    if (!enabled()) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter' && !e.repeat) controller.start();
    }
  });
  button.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') stop(); });
  button.addEventListener('click', e => { if (enabled()) e.preventDefault(); });
}
