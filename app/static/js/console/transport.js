// Pure transport state machine for the sound console. No DOM, no audio.
export const STATES = Object.freeze({
  IDLE: 'IDLE', CUED: 'CUED', PLAYING: 'PLAYING', PAUSED: 'PAUSED', FADING: 'FADING', ENDED: 'ENDED',
});

// event -> { fromState: toState }
const TABLE = {
  CUE:        { IDLE: 'CUED', CUED: 'CUED', PAUSED: 'CUED', ENDED: 'CUED' },
  UNCUE:      { IDLE: 'IDLE', CUED: 'IDLE', PLAYING: 'IDLE', PAUSED: 'IDLE', FADING: 'IDLE', ENDED: 'IDLE' },
  PLAY:       { CUED: 'PLAYING', PAUSED: 'PLAYING', ENDED: 'PLAYING', PLAYING: 'PLAYING' },
  PAUSE:      { PLAYING: 'PAUSED', FADING: 'PAUSED', PAUSED: 'PAUSED' },
  FADE_START: { PLAYING: 'FADING', FADING: 'FADING' },
  FADE_DONE:  { FADING: 'ENDED' },
  FINISH:     { PLAYING: 'ENDED', FADING: 'ENDED' },
  STOP:       { PLAYING: 'CUED', PAUSED: 'CUED', FADING: 'CUED', ENDED: 'CUED', CUED: 'CUED' },
};

export function nextState(state, event) {
  const row = TABLE[event];
  if (!row) return state;
  return row[state] || state;
}

// True when sound is (or is about to stop being) coming out of the room.
export function isLive(state) {
  return state === STATES.PLAYING || state === STATES.FADING;
}

export function createTransport(initial = STATES.IDLE) {
  let state = initial;
  const listeners = new Set();
  return {
    get state() { return state; },
    isLive() { return isLive(state); },
    send(event) {
      const next = nextState(state, event);
      if (next === state) return state;
      const prev = state;
      state = next;
      listeners.forEach(fn => { try { fn(next, prev, event); } catch (e) {} });
      return state;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
