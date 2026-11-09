/**
 * Timed LRC parser and line selector for Stage Confidence Monitor.
 * Compatible with ES Modules and Node/CommonJS.
 */

const TIME_TAG_REGEX = /\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g;
const HEADER_TAG_REGEX = /\[[a-zA-Z]+:[^\]]*\]/g;

function parseLrcClient(text) {
  const raw = String(text || '');
  const lines = [];

  const rawLines = raw.split(/\r?\n/);
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const matches = Array.from(trimmed.matchAll(TIME_TAG_REGEX));
    if (matches.length > 0) {
      const cleanText = trimmed
        .replace(TIME_TAG_REGEX, '')
        .replace(HEADER_TAG_REGEX, '')
        .trim();

      for (const m of matches) {
        const mm = parseInt(m[1], 10);
        const ss = parseFloat(m[2]);
        const time = Math.round((mm * 60 + ss) * 1000) / 1000;
        lines.push({ time, text: cleanText });
      }
    }
  }

  if (lines.length > 0) {
    lines.sort((a, b) => a.time - b.time);
    return { isTimed: true, lines, raw };
  }

  return { isTimed: false, lines: [], raw };
}

function selectLyricsDisplay(lines, currentTime) {
  if (!lines || lines.length === 0) {
    return { prev: '', current: '', next: '' };
  }

  const t = typeof currentTime === 'number' && !isNaN(currentTime) ? currentTime : 0;

  // If before the first line
  if (t < lines[0].time) {
    return {
      prev: '',
      current: '',
      next: lines[0].text || ''
    };
  }

  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= t) {
      idx = i;
    } else {
      break;
    }
  }

  return {
    prev: idx > 0 ? (lines[idx - 1].text || '') : '',
    current: lines[idx].text || '',
    next: (idx + 1 < lines.length) ? (lines[idx + 1].text || '') : ''
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseLrcClient, selectLyricsDisplay };
}
if (typeof window !== 'undefined') {
  window.EtmLyrics = { parseLrcClient, selectLyricsDisplay };
}
