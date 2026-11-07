// Output device selection via setSinkId. Hidden when unsupported; choice remembered.
export const SINK_KEY = 'etm_console_sink_id';

export function sinkSupported(mediaElement, gainStage) {
  return Boolean((gainStage && gainStage.ctx && typeof gainStage.ctx.setSinkId === 'function') ||
    (mediaElement && typeof mediaElement.setSinkId === 'function'));
}

export async function applySink(sinkId, mediaElement, gainStage) {
  // Once routed through an AudioContext, the element's own sink no longer matters.
  if (gainStage && gainStage.ctx && typeof gainStage.ctx.setSinkId === 'function') {
    await gainStage.ctx.setSinkId(sinkId || '');
    return true;
  }
  if (mediaElement && typeof mediaElement.setSinkId === 'function') {
    await mediaElement.setSinkId(sinkId || '');
    return true;
  }
  return false;
}

export async function listOutputs(mediaDevices = globalThis.navigator && globalThis.navigator.mediaDevices) {
  if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') return [];
  const devices = await mediaDevices.enumerateDevices();
  return devices.filter(d => d.kind === 'audiooutput').map((d, i) => ({id: d.deviceId, label: d.label || `Output ${i + 1}`}));
}

export function rememberedSink(storage = globalThis.localStorage) {
  try { return storage.getItem(SINK_KEY) || ''; } catch (e) { return ''; }
}
export function rememberSink(id, storage = globalThis.localStorage) {
  try { if (id) storage.setItem(SINK_KEY, id); else storage.removeItem(SINK_KEY); } catch (e) {}
}
