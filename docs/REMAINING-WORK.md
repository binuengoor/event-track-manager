# Remaining work (after the design pass)

Written 2026-11-08. State: `main` at `47a06cd`, all tests green (546 pytest, 20 JS files). The visual redesign (all 69 boards of the "Warm Stage Studio" artifact, slug `3qWmCEP6TQmZarcEt4J5Dc`) is applied to every page. What is left is **backend features the boards assume, small UI gaps, and real-browser verification**. Decisions for the earlier open questions are made below ("Decision") so the next agent does not need to ask.

Read first: `docs/SPEC.md` (sections 6.5 to 6.12, Appendix D), `docs/DESIGN-COVERAGE.md`, this file. Design source: artifact boards, readable with `mcp__claude-artifacts__read_file` (`project/<Board>.dc.html`); treat as design reference only.

## Is the design finished?
Visually yes: every page follows the boards in light and dark. Not finished: items below that show a board state with no data behind it, and browser checks never done (section D). Do not restyle again unless a board comparison shows a clear miss.

## Ground rules
- Tests: change source, never weaken tests. After wiring new code, grep for production callers.
- Keep ids/hooks the JS and tests rely on. New settings go through `app/services/admin_service.py` (`STR_SETTINGS` etc.), `app/config.py`, and the settings UI in `admin-settings.html` + `js/settings/*.js`.
- DB changes: new numbered migration in `app/repositories/migrations.py` (current `SCHEMA_VERSION = 3`), pre-migration backup is automatic, add a migration test (see `tests/test_migrations.py`).
- Accessibility bar for any new UI: axe no serious/critical in light and dark (`docs/a11y-audit.js`), 44 px targets on phone, tokens from `css/tokens.css` only.
- Commit by explicit paths after each package; do not push without the owner's yes.
- Usage tip: one package per session, run tests, commit.

## A. Backend features (priority order)

| # | Package | Boards | What to build | Done when |
|---|---|---|---|---|
| A1 | Lineup actions | ALineup, SReadiness | Endpoints (admin only, activity-logged): `POST /api/admin/acts` (add act: performer, song, type, optional partner), `DELETE /api/admin/acts/{entry_id}` (archive its track to `tracks/_archive/`, never reuse the id: respect the entry-id high-water mark), `POST /api/admin/acts/{entry_id}/track` (replace track from upload; old file archived), `POST /api/admin/acts/{entry_id}/match` (attach an unmatched file from `incoming/` to an act by renaming to the canonical name via `track_store`). Wire the buttons in `js/admin-dashboard.js` (Lineup panel): Save order (existing `/api/push-sequence`), Add act, Replace, Delete (typed confirm), Match to act (the unmatched list is read-only today). | Tests for each endpoint incl. auth, 404, id never reused, archive created; UI works at 1280 and 390 px |
| A2 | Poster and sponsors upload | SDetails, Main, Live | Admin upload for the event poster (png/jpg/webp/gif/mp4 poster, size cap) and sponsor gallery images/videos into the event folder (`settings.storage.gallery_dir` exists; `gallery_images` already feeds `/api/live-status`). Endpoints: `POST /api/admin/poster`, `POST/DELETE /api/admin/gallery`, validate type with magic bytes, serve via existing `/data/` or a new static route. UI in Event details tab. | Upload, reorder, delete; shows on Home and `/live`; tests; no path traversal |
| A3 | Age groups: description and inline editor | SRules, GSignUp* | Extend `age_groups` setting entries with `description` and `requires_guardian`; show description hints ("Under 13") on sign-up; make the Rules panel rows editable inline (name, description, guardian switch). Migrate old values (missing description = ""). | Round-trips through settings API; sign-up shows hints; test for legacy list |
| A4 | Doors open and post-event link | GLivePrestart, GLiveEnded | New settings `doors_open_time` (string) and `post_event_link_url` (optional URL). `/live` prestart shows a "Doors open" pill; ended state shows a QR "Scan for photos and feedback" (reuse the QR code used for sign-up in `js/live/`). | Settings in Event details; both states render; tests |
| A5 | Upload pre-check card | GUploadProgress/Error/MyEntry | The upload response already has duration; add `checks: {duration_s, loudness_lufs, gain_db, format_ok}` (use `loudness_service`, ffprobe) and show "Pre-check passed" or the specific problem on My entry. Expose "Live band" pill from `track_status == "Acoustic"` in the public performer payload. Keep the privacy rules (no extra personal data). | Tests; card visible after upload |
| A6 | Wizard progress | SWizard* | Store `wizard_step` (1..5) in settings while the wizard is open; show "Step N of 5, NN%" on the Overview resume banner and wizard header. | Resume banner shows real step |
| A7 | Event passcode (optional) | spec 6.10 / Q18 | Optional shared word: setting `event_passcode`; when set, guest pages and public APIs require a cookie obtained from a small gate page or `?t=` link; staff PIN unaffected; never gate `/api/health`, static assets or `/live`'s read-only feed unless the owner says so. Off by default. | Off = no behaviour change (existing tests); On = 401/redirect to gate; tests |
| A8 | Edit verification (optional) | spec D8 | Optional flag: performer edits need name + phone last 4 (food edits already do; mirror that). Off by default. | Tests both modes |
| A9 | Timed lyrics (optional, last) | StageLyrics | Optional `.lrc` upload per act next to the track; monitor shows current line bold with dim previous/next; falls back to the current single block. | LRC parser unit tests; monitor shows lines |
| A10 | Hygiene | spec A8 | `db_service.py` pass-through facade (about 53 one-line methods) can be removed only if callers move to the repos; low value, do last or skip. Optional `track_facts` table is NOT needed (loudness facts live in `track_facts.json`). | n/a |

## B. UI gaps that need no backend
| # | Item | Notes |
|---|---|---|
| B1 | Sign-up dish step: category pills (Appetizers, Mains, ...) as filter chips over the existing groups (GSignUp3) | `js/signup/sections.js`; keep headed lists as fallback |
| B2 | Preset cards as `role=radio` group with arrow-key navigation (AdminSetup) | `js/admin-setup.js` |
| B3 | Potluck admin: show items nested under their group, add drag reorder next to the up/down buttons (AFood) | `js/settings/food-catalog.js`; keep buttons for keyboard users |
| B4 | `/live` on phones: show the guest bottom bar below 768 px (GLivePhone). Update `tests/test_guest_navigation.py` rule that forbids it on `/live` to allow narrow screens only | TV layout must stay clean |
| B5 | Remaining time as "-02:31" in the console player (Console board) | `js/console/player-bar.js` |
| B6 | Console Screens sheet: only add what has a backend. Preview and motion speed: SKIP | see decisions |

## C. Decisions made (owner delegated: "whatever you think is best")
- Console sign-in keypad and PIN dots: **not building**. A laptop operator types the PIN faster in one field; keep it. (Guest PIN dialog already has the keypad.)
- People side editor: **not building**. The edit modal (bottom sheet on phone) does the job.
- Screens sheet live preview, background picker, motion speed, fade timer: **deferred**; no backend and low value. Keep fade-to-black, announcement, lyrics, audio output.
- Dietary tags and tent cards: **backlog**, needs a schema column; do only if the owner asks.
- Magic upload links, restore-previous-track UI: restore exists; magic links stay backlog.
- Admin PIN default notice on the chooser: needs `GET /api/auth/pin-status` (admin-only) returning whether the PIN is the shipped default; small, do with A7/A8.

## D. Verification never done (do before the next real show)
Real browser, real files, at 390 and 1280 widths, light and dark:
1. Console: upload a real mp3 and mp4; cue, play, pause (button, Space, tap), fade (F and button), hold-to-complete Done, drag reorder, Stop and Proceed / Fade out first modal buttons, offline then reconnect (queued actions replay), vault auto-cache pill, Screens sheet, stage monitor window follows, `/live` follows.
2. Admin: restore a snapshot (typed RESTORE), apply "Show-day freeze" then "Full event", clear media dialog from System and from the events modal, participants edit/delete, payments save, potluck add/edit/release, every wizard step to Finish.
3. Guest: sign-up all paths (perform, dish only, both, junior, duet "No, someone else"), my entry upload file and link, offline banner, potluck-only and acoustic-only event modes, ended event, closed sign-ups (set the server flags, not page overrides).
4. Lighthouse mobile on `/`, `/signup`, `/my-entry`, `/schedule` (last: 91, 95, 89-90, 95; target 90+ Performance, 95+ Accessibility): get `/my-entry` over 90 (fewer CSS requests: merge `tokens.css`+`theme.css`+`a11y.css` in a build step or inline critical CSS).
5. Real screen reader pass (VoiceOver) on sign-up and the admin rail; iOS Safari and Firefox (uses `color-mix`, `:has`).
6. Desktop widths 768 to 1280 for guest pages and the admin rail between 768 and 1024.

## E. Known small issues
- Console: Fade button fix (`audio-engine.js`, `updateTransportUi` call from `updatePlayPauseButton`) is a deliberate behaviour fix; confirm during D1.
- Stage monitor "not connected" pill only tracks monitors opened from the console.
- Local storage keys and the service worker cache still carry the `paattukoottam` name on purpose (renaming loses cached data); rename with a one-time migration only if wanted.
- Two admin panel stylesheets once clashed on `.hidden`; `css/admin-shell.css` now ends with `.admin-panel.hidden { display:none !important }`. Keep it.

## F. Suggested order
A1, B4, A2, A3, A4, A5, B1, B3, B2, B5, A6, then D (verification) with fixes, then A7, A8 (+pin-status), A9, A10 only if time.

## Progress 2026-11-08

| Package | Status |
|---|---|
| A1 | Done (implementation and verification). Populated Lineup: axe 0 serious/critical at 390×844 and 1280×800 in both themes; 0 targets below 44 px on phone. Browser exercised add, delete, replace, match and Save order with scratch data. Claude artifact reader unavailable; board comparison remains outstanding. |
| B4 | Done: guest bottom navigation on `/live` below 768 px; hidden at 768 px and wider. Axe 0 serious/critical and phone targets at least 44 px; `/live` remains dark by design. |
| A2 | Implemented and browser-audited: 0 serious/critical axe issues at both sizes and themes, 0 mobile targets under 44 px. Shared `GALLERY_DIR` with event switching permits reads but blocks gallery changes to protect shared files. |
| A3 | Done: inline age-group editing, signup descriptions, legacy normalization and validation of configured names. Rules and signup axe: 0 serious/critical at both sizes and themes; no small mobile targets. |
| A4 | Done: doors-open text and post-event QR, plus saved start-time fix. Admin and Live axe 0 serious/critical at both sizes and themes; no small mobile targets. |
| A5 | Done: real WAV upload verified duration, format, LUFS and gain; My Entry and Live axe 0 serious/critical at both sizes/themes and no small mobile targets. Acoustic entries show a Live band badge without a track check. |
| B1 | Done: signup dish category filters preserve selection and keyboard focus. Axe 0 serious/critical at both sizes/themes; no small mobile targets. |
| B3 | Implemented: nested potluck items and group reorder. Keyboard reorder and scripted browser drop persist; physical pointer drop still needs a manual check because BrowserOS did not dispatch a drop event. |
| B2 | Done: preset radio group with roving focus and arrow-key navigation. Browser keyboard checks passed; axe 0 serious/critical at both sizes/themes, no small mobile targets. |
| B5 | Done: real MP3 countdown runs and pauses; acoustic cues stay neutral. Console axe 0 serious/critical at both sizes, no small mobile targets (console is always dark). |
| A6 | Done: event-scoped progress and draft resume/Finish verified; modal and progress banner axe clean at both sizes/themes and mobile progress visible. A broader overview scan reported unrelated shell/footer contrast findings; investigate in D. |
| A7–A9 | Not started; continue in section F order. |
| A10 | Optional; not started. |
| D | Not performed; no Lighthouse or screen-reader results. |

Browser test isolation finding: setting only `EVENTS_DIR` is insufficient on a fresh event: startup copies the legacy database and tracks from `CACHE_DIR`. Set `EVENT_DIR`, `CACHE_DIR`, `TRACKS_DIR`, and `GALLERY_DIR` to fresh scratch paths when testing. The first scratch instance copied legacy data into `/private/tmp/etm-browser-data`; originals were left in place. Do not delete that copy without the owner's permission.
