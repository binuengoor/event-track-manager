# Design coverage: every existing feature and where it is drawn

Design canvas: "Event Track Manager Design" (69 boards, Warm Stage Studio look), round 2, updated 2026-11-07. Round 2 adds the owner's review decisions (see SPEC Appendix D) and the previously missing states: dish-only sign-up, junior and partner flows, validation errors, upload progress and errors, closed states, Admin PIN with lockout and chooser, console login, monitor disconnected, long names, venue pre-show/ended/phone views, wizard steps 1 to 5, empty states, dark guest variants.
Every screen below exists as a board unless marked **Pattern** (same components as a drawn board, no separate board).
Boards are static mock-ups: they were written as code and **not yet reviewed in rendered form by the assistant**; fit and spacing need an owner look.

Upstream check (2026-11-07): `origin/main` was `2fc83ae` and nothing upstream was missing from local `main`.

## Guest (phone unless stated)

| Existing feature | Board(s) |
|---|---|
| Landing: name, poster or GIF, venue, time, countdown, sponsors | Guest home (light); Home, event ended; Home, potluck-only |
| Sign-up: performer solo/duet/group, songs, age group, guardian, optional dish, acoustic flag | Sign up step 1, Sign up step 2 (song, duet partner), Sign up step 3 (dish) |
| Food-only attendee | Sign up step 1 type choice, Home potluck-only |
| Existing-name lookup, add another act, upload now, add a dish | Sign up step 1, Sign-up done |
| Performer Hub: edit song, partner, notes, type, add act, upload file or link, dish | My entry |
| Dashboard setlist and potluck board | Schedule (dark, Lineup); Schedule: potluck board |
| Offline behaviour | Schedule, offline banner |
| Live screen: now on stage, up next, announcement, sponsors | Live venue screen; Live with faded image backdrop; Live before the show; Live off |
| Staff sign-in | Staff PIN dialog |

## Console (laptop, always dark)

| Existing feature | Board(s) |
|---|---|
| Queue, cue, player, hotkeys, status, notes | Sound console |
| Video acts | Console: video act playing |
| Reorder, Save Order | Console: order unlocked, mid-drag (auto-save) |
| Disruption warning | Console: cue now? confirm |
| Offline queue and network indicator | Console: offline, changes waiting |
| Offline vault | Console: vault sheet; vault pill on every console board |
| Announcement, per-act backdrop, stage monitor controls | Console: Screens sheet |
| Stage monitor: name card, video, lyrics, standby | Stage monitor: name card; lyrics; video act; standby; name card faded |
| Offline ZIP | Admin: System (Pattern in Console menu) |

## Admin (desktop and phone)

| Existing feature | Board(s) |
|---|---|
| Readiness strip and checks | Admin overview; Admin: readiness checks |
| Show-day controls, stats | Admin overview |
| Setup wizard | Admin: setup wizard step 2 (other steps: Pattern) |
| Event details, poster, sponsors gallery | Admin: event details |
| Sign-up rules, age groups, safety switches | Admin: sign-up rules |
| Features and presets with change preview | Admin: event type, presets, change preview |
| Running order, track status, unmatched files, restore previous track | Admin: Lineup |
| Participants (edit, delete) | Admin: Participants with row editor; Admin phone: participants |
| Payments | Admin: Payments |
| Food and potluck management | Admin: Potluck groups and quick add |
| Spreadsheet viewer and downloads | Admin: Data viewer and downloads |
| Events, switch, snapshots, export | Admin: system, events and backups |
| Clear media | Admin: clear media confirm |
| Activity log | Admin: activity log |
| Admin on a phone | Admin phone: overview; Admin phone: More sheet |

## Still Pattern only (no own board)
Light-theme console, dark-theme admin, skeleton and loading states, reduced-motion variants.

## New in the design (not in the app today)
Poster/GIF/video hero, sponsor reel (Home, Live), faded image or solid backdrop per act, announcement vs act note, stage monitor fade to black and optional lyrics, minor short names, existing-name lookup, order lock with auto Save Order, vault pill with auto-cache, fade out, Cue next, readiness PIN-length warning, show-day controls, Screens sheet, Admin left rail and phone bottom bar, guest bottom tab bar.
