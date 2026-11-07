// Console -> screens messaging. Channels are injected so tests need no browser.
export function buildMonitorMessage(kind, value) {
  switch (kind) {
    case 'ANNOUNCEMENT': return {type: 'ANNOUNCEMENT', text: String(value ?? '')};
    case 'FADE_BLACK': return {type: 'FADE_BLACK', on: Boolean(value)};
    case 'LYRICS': return {type: 'LYRICS', text: String(value ?? '')};
    default: throw new Error(`Unknown screens message: ${kind}`);
  }
}

export function clampAnnouncement(text) {
  return String(text ?? '').trim().slice(0, 140);
}

export function createScreens({monitorChannel, liveChannel, fetchRequest = fetch, getHeaders = () => ({})}) {
  const post = (ch, msg) => { try { if (ch) ch.postMessage(msg); } catch (e) {} };

  // Relay the server's redacted /api/live-status shape; never built from admin data.
  function relayStatus(status) {
    if (!status || typeof status !== 'object') return false;
    post(liveChannel, {type: 'LIVE_STATE', status});
    return true;
  }

  async function relayLiveState() {
    try {
      const res = await fetchRequest('/api/live-status');
      if (!res.ok) return false;
      return relayStatus(await res.json());
    } catch (e) {
      return false;
    }
  }

  async function sendAnnouncement(text) {
    const clean = clampAnnouncement(text);
    let saved = clean;
    let persisted = false;
    try {
      const res = await fetchRequest('/api/announcement', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json', ...getHeaders()},
        body: JSON.stringify({text: clean}),
      });
      if (res.ok) {
        persisted = true;
        const data = await res.json().catch(() => null);
        if (data && typeof data.text === 'string') saved = data.text;
      }
    } catch (e) {}
    // Endpoint may be missing or the network down: still reach screens in this browser.
    post(monitorChannel, buildMonitorMessage('ANNOUNCEMENT', saved));
    post(liveChannel, {type: 'ANNOUNCEMENT', text: saved});
    if (persisted) await relayLiveState();
    return {persisted, text: saved};
  }

  return {
    sendAnnouncement,
    relayLiveState,
    relayStatus,
    setFadeBlack(on) { post(monitorChannel, buildMonitorMessage('FADE_BLACK', on)); },
    sendLyrics(text) { post(monitorChannel, buildMonitorMessage('LYRICS', text)); },
  };
}
