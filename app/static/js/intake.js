// 
// Classic script: shares globals with the other intake files (see load order in the page).

// My entry (guest): edit acts, upload a track or paste a link, manage a dish.
const NAME_KEY = 'etm_guest_name';
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'];
const DEFAULT_ALLOWED_EXTS = ['mp3', 'wav', 'm4a', 'mp4', 'webm'];
const LINK_HOSTS = ['soundcloud.com', 'on.soundcloud.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
let maxAudioMb = 200;
let maxVideoMb = 500;
let allowedExts = DEFAULT_ALLOWED_EXTS.slice();
let allowedMedia = null; // from /api/event-info allowed_media
let activeXhr = null;
let lastSubmitFailed = false;
let performances = [];
let selectedPerformer = null;
let selectedEntry = null;
let currentMethod = 'file'; // 'file' or 'youtube'
let currentMediaType = 'audio'; // 'audio' or 'video'
let sheetUrl = '';
let performerFoodSignup = null;
let profileLookupVersion = 0;
let allFoodGroups = [];
let allFoodItems = [];
let foodServingNote = 'Bring one dish to share';
let pendingDeepLinkFoodItem = null;
let maxPerformancesPerParticipant = 2;
let maxSoloPerParticipant = 1;

document.addEventListener('DOMContentLoaded', async () => {
  await initEventInfo();
  await loadPerformances();
  await loadFoodCatalog();
  setupEventListeners();
  setupAddPerformanceModal();
  handleUrlQueryParams();
});

function handleUrlQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const nameParam = params.get('name') || params.get('performer');
  const foodParam = params.get('food_item');

  if (foodParam) {
    pendingDeepLinkFoodItem = foodParam;
  }

  if (nameParam) {
    const select = document.getElementById('performer-select');
    // Try exact or case-insensitive match
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value.toLowerCase() === nameParam.toLowerCase()) {
        select.selectedIndex = i;
        selectedPerformer = select.options[i].value;
        handlePerformerSelected(selectedPerformer);
        break;
      }
    }
  }

  if (pendingDeepLinkFoodItem && !selectedPerformer) {
    // Show banner or focus performer select
    const hint = document.getElementById('food-cta-section');
    hint.classList.remove('hidden');
    hint.innerHTML = `
      <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-300">
        <span>Please choose your name from Step 1 above to sign up for this dish.</span>
      </div>
    `;
  }
}
