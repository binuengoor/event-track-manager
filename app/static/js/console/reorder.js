// Reorder lock and idle-push scheduling (pure; timers injectable).
export const PUSH_IDLE_MS = 5000;

export function createReorderLock() {
  let unlocked = false; // default locked on every console open: safe during the show
  return {
    get locked() { return !unlocked; },
    toggle() { unlocked = !unlocked; return !unlocked; },
    lock() { unlocked = false; },
    unlock() { unlocked = true; },
    canDrag(searching) { return unlocked && !searching; },
  };
}

export function createIdlePusher({push, idleMs = PUSH_IDLE_MS, setTimer = setTimeout, clearTimer = clearTimeout}) {
  let handle = null;
  return {
    get pending() { return handle !== null; },
    touch() {
      if (handle !== null) clearTimer(handle);
      handle = setTimer(async () => { handle = null; await push(); }, idleMs);
    },
    flush() {
      if (handle === null) return false;
      clearTimer(handle);
      handle = null;
      push();
      return true;
    },
    cancel() { if (handle !== null) clearTimer(handle); handle = null; },
  };
}

export function moveItem(list, from, to) {
  const copy = list.slice();
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy.map((it, i) => ({...it, sequence_order: i + 1}));
}
