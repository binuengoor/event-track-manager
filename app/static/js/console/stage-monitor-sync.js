// Console-to-stage-monitor state transport; caller supplies live player state.
export function createStageMonitorSync(getState) {
  const channel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('stage_monitor_channel') : null;

  function broadcast(eventType = 'SYNC') {
    if (!channel) return;
    const {item, wavesurfer, isPlaying, next} = getState();
    if (!item) {
      channel.postMessage(next ? {type: 'UNCUE', nextPerformer: next.performer_name, nextSong: next.song_title} : {type: 'UNCUE'});
      return;
    }
    const isAcoustic = item.track_status === 'Acoustic';
    const isVideo = (item.media_type === 'video') || (item.track_file && item.track_file.endsWith('.mp4'));
    const currentTime = (wavesurfer && typeof wavesurfer.getCurrentTime === 'function') ? wavesurfer.getCurrentTime() : 0;
    channel.postMessage({
      type: eventType,
      entryId: item.entry_id,
      performerName: item.performer_name,
      partnerName: item.partner_name || '',
      songTitle: item.song_title,
      mediaType: isAcoustic ? 'acoustic' : (isVideo ? 'video' : 'audio'),
      streamUrl: `/api/stream/${item.entry_id}`,
      currentTime,
      isPlaying
    });
  }

  if (channel) {
    channel.onmessage = event => {
      if (event.data && event.data.type === 'REQUEST_STATE') {
        broadcast(getState().item ? 'CUE' : 'UNCUE');
      }
    };
  }
  return {broadcast};
}

// A monitor window opened from this console is watched until it is closed; the header shows
// "Stage monitor not connected" once it has been. A monitor opened some other way is not tracked.
let monitorWindow = null;
let monitorWatch = null;
function showMonitorStatus(disconnected) {
  const el = typeof document !== 'undefined' ? document.getElementById('monitor-status-indicator') : null;
  if (el && el.classList) el.classList.toggle('hidden', !disconnected);
}
export function openStageMonitor() {
  monitorWindow = window.open('/console/stage-monitor', 'StageMonitor', 'width=1280,height=720,menubar=no,toolbar=no,location=no');
  showMonitorStatus(false);
  if (monitorWatch) clearInterval(monitorWatch);
  if (!monitorWindow) return monitorWindow;
  monitorWatch = setInterval(() => {
    if (!monitorWindow || monitorWindow.closed) {
      clearInterval(monitorWatch);
      monitorWatch = null;
      monitorWindow = null;
      showMonitorStatus(true);
    }
  }, 2000);
  return monitorWindow;
}
