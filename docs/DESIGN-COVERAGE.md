# Design coverage: every existing feature and where it lands

Status of the proposed design (canvas "Event Track Manager Design", 2026-11-07) against everything the app does today
(`docs/SPEC.md` section 3). **Drawn** = a board exists. **Pattern** = covered by a component already drawn (same row, form, switch or table
pattern) and gets its own board in Phase 3 if the owner wants to review it. **Keep** = works today, no visual change needed beyond tokens.

Upstream check (2026-11-07): `origin/main` is `2fc83ae`; local `main` was 4 commits ahead (docs only) and nothing upstream was missing, so no features are unaccounted for.

## Guest

| Existing feature | Where in new design | Status |
|---|---|---|
| Landing: name, poster or GIF, venue, time, countdown, ended state, notes, payment link | Guest home | Drawn (poster slot, countdown, sponsors); ended state and notes: Pattern |
| Sign-up: performer solo/duet/group, songs, age group, guardian, optional dish, acoustic flag | Sign up (3 steps) | Drawn step 1; steps 2 and 3 and the duet partner fields: Pattern |
| Sign-up: food-only attendee | Sign up, type choice at step 1 | Pattern |
| Existing-name lookup, add another act, upload now, add a dish after sign-up | Sign up and success card | Drawn (lookup); success card: Pattern |
| Performer Hub: pick name, edit song, movie, partner, notes, type, add act, rename self | My entry | Drawn (act card, edit); rename and partner editing: Pattern |
| Upload file or paste YouTube/SoundCloud link, audio or video, progress | My entry | Drawn (upload zone, link field); progress and errors: Pattern |
| Claim, change, release a dish | My entry (My dish) and Schedule, Food | Drawn |
| Browse everyone's songs | Schedule, Lineup | Drawn |
| Dashboard: setlist and potluck board | Schedule with Lineup and Food switch | Drawn (both) |
| Attendee Hub and Food Board relabelling when stage is off | Navigation labels from event type | Pattern (nav rules 6.5) |
| Live screen: now on stage, up next, upcoming, notes, sponsor gallery, countdown before start, inactive card | Live venue screen | Drawn; pre-start countdown and inactive card: Pattern |
| Staff sign-in | Footer link, shared PIN dialog | Pattern |

## Console

| Existing feature | Where | Status |
|---|---|---|
| Queue with search, status, track readiness, type pills, extra columns | Console queue | Drawn (search and extra columns: Pattern) |
| Cue (load without autoplay), uncue, reload restores cue | Console deck, "Cue next" | Drawn |
| Player: waveform, play/pause, seek, mute, mark performed, download | Console deck | Drawn (seek and download controls: Pattern) |
| Disruption warning before cutting live audio | Confirm dialog | Pattern (native dialog) |
| Status Upcoming/On Stage/Performed/On Hold, stage notes | Row menu and notes field | Pattern |
| Reorder, dirty badge, Save Order | Order lock (drawn); Save Order auto-runs | Drawn (lock) |
| Offline vault, per-track cache, clear cache | Vault pill (drawn); vault detail panel | Drawn (pill); panel: Pattern |
| Offline queued actions and network indicator | Header "Online" chip | Drawn |
| Offline ZIP for USB | Console menu and Admin, System | Pattern |
| Stage monitor (video, muted, standby card, sync status) | `/console/monitor` full screen | Not drawn: Phase 3 board |
| Video tracks (preview, 720p) | Console deck video variant | Not drawn: Phase 3 board |

## Admin

| Existing feature (tab today) | New destination | Status |
|---|---|---|
| Event bar: switch, create event, Manage, Clear media | Rail header and System | Header drawn; Manage and Clear media: Pattern |
| Readiness strip | Overview | Drawn |
| Setup wizard | Overview banner, steps | Banner drawn; wizard steps: Pattern |
| Event Details | Setup and Rules, Event details | Not drawn: form pattern |
| Sign-Up Rules | Setup and Rules, Sign-up rules | Not drawn: form pattern |
| Features and Presets with change preview | Setup and Rules, Event type and features | Drawn |
| Food and Potluck (groups, items, claims, quick add, templates) | People and Potluck | Not drawn: Phase 3 board |
| Participants (edit, delete, link dish) | People and Potluck | Not drawn: table-to-cards pattern |
| Spreadsheet viewer and downloads | People and Potluck, Data | Not drawn: Phase 3 board |
| Payments (Paid, note, filter, progress) | People and Potluck | Not drawn: Phase 3 board |
| Stats | Overview tiles | Drawn |
| Backup and Sync, export now, history | System | Not drawn: Pattern |
| Activity log | System | Not drawn: table pattern |
| Show-day quick controls | Overview | Drawn (new) |

## New in the design (not in the app today)
Poster/GIF/video hero, sponsor reel on Home and Live, minor short names, existing-name lookup, order lock with auto Save Order, vault pill with
auto-cache, fade out, Cue next, readiness PIN-length warning, show-day controls on Overview, Admin left rail, guest bottom tab bar.
