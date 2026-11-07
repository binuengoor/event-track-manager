# Design review 2 (independent, read-only)

Reviewed from markup only. Nothing was rendered and no animation was seen.
Boards read in full: 28 of 44 (all guest phone boards except Food, all venue/stage boards except Prestart, Off, StageLyrics and the two Video/Faded monitors, Console main and its Confirm/Offline/Screens variants, Admin overview, Lineup, People, Phone People, More, Rules, Potluck-only, Ended, Offline). Not read: Food, CVault, CReorder, CVideo, SWizard, SDetails, SClearMedia, SSystem, SActivity, SReadiness, AFood, APayments, AData, AdminSetup, GLivePrestart, GLiveOff, StageLyrics, CMonitorVideo, CMonitorFaded, SOverviewPhone. Findings about those are not made. Contrast numbers are estimates from hex values.

## 1. Verdict
Visually coherent and close. The Warm Stage Studio palette, pill and card language, and nav pattern are applied consistently, and the console confirm dialog and stage-monitor states are well thought out. It is not ready to build yet. There is one privacy leak (sign-up lookup), one dead flow (food-only sign-up), unreadable venue-screen text sizes, and several naming and number conflicts to fix first. Most fixes are small copy or markup changes. Several essential states (errors, sign-up closed, upload progress) are not drawn.

## 2. Findings

### Must fix
1. **SignUp step 1: the name lookup leaks private data.** Typing "Maya Nair" shows her act (PK-001, Kannalane) and pre-fills her phone "610 555 0123" in the form. Anyone can type any name and read the phone number. This breaks the "phones never shown publicly" rule. Fix: never pre-fill phone or guardian fields from a name match. Show only "Maya Nair already has 1 act" with Edit and Add another. Make the phone mandatory to type again, or verify it before editing.
2. **"Bring a dish" has no flow.** On Main it links to `#`. SignUp step 1 has no performer / food-only choice, although DESIGN-COVERAGE lists "Sign up step 1 type choice". GSignUp3 is titled "Sign up to perform" and can only be reached after a song. Food-only guests have no path. Fix: add a first choice "Perform / Bring a dish / Both" on step 1, or a separate short dish form (name, phone, dish).
3. **Junior sign-up lacks guardian fields.** Step 1 shows only Junior / Senior. SRules says Junior requires a guardian name and phone, and the phone defaults to the guardian's. Fix: draw the Junior state with guardian name and phone. Also replace the 2-way segmented control with a list or radio group, since admins can add age groups (SRules "Add age group").
4. **Venue screen text is too small for a TV.** Live and LiveBackdrop use 13px labels, 14 to 16px for the announcement, the up-next artist and the footer. At 1280x720 on a room-sized screen the minimum should be about 24px. The announcement is the only organizer message to the room, so make it prominent (28px or more, not a 340px side card). Same for the console "Edit note" link (12px, tiny target).
5. **Two juniors-privacy mechanisms conflict.** SRules has a global switch "Juniors: first name and last initial". SignUp step 1 has a per-guest checkbox "Show only first name and last initial". It is unclear which wins. APeople's editor shows the stored name as "Anika M.", which suggests the full name was lost. Fix: store the full name; derive the short form on display. Pick one rule, or state "juniors are always shortened; adults can opt in".
6. **Upload limits contradict each other and the spec.** MyEntry: "MP3, WAV, M4A or MP4 video, up to 100 MB". GSignUpDone: "MP3 or M4A, up to 25 MB". SRules lists mp4, mov and webm. SPEC says audio 200 MB, video 500 MB, with a Cloudflare 100 MB cap (N15). Fix: one limit, read from settings, plus an "after upload" state. The spec says only `.mp4` is treated as video today (A9), so `.mov` and `.webm` should not be promised.
7. **Default PIN shown in the UI.** Admin overview prints "Admin PIN is still the default (2026)". If that is the real default, the screen leaks it to anyone looking over the organizer's shoulder, or to a screen share. Say "still the default PIN" without the digits.
8. **After the PIN, where does the user land?** One PIN opens console and admin. No board shows a chooser or a landing rule, and neither the admin rail nor the phone More sheet links to Console, Live, or Stage monitor. Fix: add a post-PIN "Open Console / Open Admin" step, and "Show-day links" (Console, Live, Stage monitor) in the admin Overview.
9. **Lockout state missing from the PIN dialog.** SPEC section 3.1: 429 after 8 failures. Draw "Too many tries, wait 5 minutes". Also the board title still says "Staff PIN dialog" (canvas title and file name GStaffPin) though the dialog says "Admin sign-in".

### Should improve
1. **Console "Done = Enter" is risky.** Cancel is protected in CConfirm, but Enter on the main console ends the act. Require a confirm, or press-and-hold, or use a different key.
2. **Console boards are not identical.** Console.dc has inline Announcement and Background panels and no Screens button. CScreens adds a Screens button and a sheet that duplicates both panels. CConfirm/COffline show "Send" / "Change" while Console.dc shows "Send to screen" / "Clear" / two buttons, and the act note is shown inline in some and as a separate row in others. Choose one: keep the Screens sheet and remove the inline panels, and use the same labels everywhere.
3. **Stage monitor shows developer annotations.** "Synced with console · goes dark in 8 s" and "Audio act: name card, then black" appear on the performer-facing screen. They should be console-only.
4. **Guests' "Live" tab opens a 1280x720 TV layout.** No phone version is drawn. Either hide Live from the phone tab bar or draw a phone view. Same for the countdown's ticking seconds and the sponsor reel (see reduced-motion below).
5. **Touch targets under 44px.** Home and potluck Admin pill (about 28 to 32px), "Open" on potluck food rows (40px), category chips in step 3 (40px), Admin PIN keys are fine (56px), phone Lineup/People filter chips (36px), ALineup action icons (28px, desktop OK but not on phone), console header pills.
6. **Semantic misuse for toggles.** Age group, Type, Schedule and tab-style toggles use `role="tablist"` on anchors. They are radio groups or segmented controls. Rails use `<a href="#">` for actions. Needs real buttons and focus styles. No focus ring is drawn anywhere except the CConfirm Cancel button.
7. **Duplicate "Admin" meanings in the console header.** "Online" and "Admin" are look-alike bordered pills (status vs role). Make the role pill different or add a menu.
8. **Public lineup shows "Needs track" and the junior label.** "Anika M. · Junior" and an amber "Needs track" chip on the public Schedule tell everyone who is late and who is a child. Make "Needs track" admin/console-only, and drop "Junior" from public rows.
9. **Sample data differs between boards.** Paid is 16/27 (Overview, Payments tab), 15/24 (phone Overview); "11 singers not paid" vs "9 singers to go"; readiness "2 to fix" (desktop) vs "3 warnings" (phone). Duet is "Arun & Divya" in Lineup but "Arun Mathew" and PK-024 in sign-up. Harmonize so developers do not copy the wrong numbers.
10. **Sign-up fee card always shows** on GSignUpDone. Draw the payment-off and already-paid states, since it is a manual Paid checkbox.

### Nice to have
- Live footer: use a QR code plus short URL instead of the hard-coded `eventmanager.extonmalayali.org` (must come from settings).
- Home countdown: four coloured tiles (terracotta, amber, green, indigo) are decorative colour with no meaning; white on #E8A33D is avoided, good, but 11px labels are small. Potluck-only Home uses "42d 06h 18m" instead of tiles; pick one.
- Step 3 button "Review and submit": no review screen exists; call it "Submit".
- Solid-colour swatches in CScreens have no labels or aria text.
- Phone Admin: the header has 56px top padding on some boards and 16px on others.

## 3. Missing screens and states
Essential before building:
- **Sign-up validation errors** (empty name, bad phone, duplicate act, limit reached "max 2 songs per person", duet partner missing).
- **Sign-up closed / uploads closed** (Overview toggles exist, but no guest-side result). Also the "Live screen visible: off" guest tab state.
- **Upload progress, success, error** (file too big, wrong type, link rejected, downloading from YouTube, processing). Offline sign-up and offline upload submit.
- **Console PIN login on a laptop**, lockout, and the stage-monitor "window closed / not connected" indicator in the console.
- **Admin empty states** (no acts yet, no dishes, no sponsors) and the first-run wizard steps 1, 3, 4, 5 (only step 2 drawn).
- **Long-name behaviour**: 60-character event name, long song titles on Live (76px, no clamp), group names.

Should have: dark guest Home, SignUp, MyEntry (only Schedule is dark), reduced-motion variants (ambient lights respond, countdown seconds, sponsor reel auto-scroll do not), upload for multiple acts, 24+ acts on console (search/filter noted as Pattern only), event type variants (karaoke, competition) on Home and Console, skeleton/loading.

## 4. Cross-screen consistency
- **Schedule vs Lineup.** Guest nav says "Schedule" with a "Lineup · 24" tab; admin and console use "Lineup" and "Running order". Pick one public word.
- **My entry vs Performer Hub vs My dish**: potluck-only nav says "My dish" but links to the same My entry board, which is about songs. Draw a dish-only version.
- **Cue vs Queue**: used consistently (Cue next, Queued pill), but the console "Queued" pill (offline sync) and "Ready" tag share the word with the order list; rename the pill "Waiting to sync".
- **Announcement**: "Send to screen" / "Send" / "Send" + "Clear". **Sign out**: "Sign out" vs "Admin sign out". **Switch event** vs "Switch or create event".
- Admin rail uses "People & Potluck" but the phone nav says "People"; "Setup & Rules" vs "Setup".
- Accent: #C84B31 buttons with white text (about 4.7:1) is fine; #B5412A used for text links. Dark accent #F06449 with #141518 text fine. Keep both.

## 5. Conflicts with how the app really works
- Stage notes are public today (SPEC section 3.2, `/live`). The design moves them to console/monitor only. That is a deliberate change; make sure it appears in SPEC section 6.
- Edit-by-name is intentional, but the design exposes entry id plus act title to anyone who types a name (see Must fix 1).
- The Console keeps working offline, but the stage monitor only syncs in the same browser profile (SPEC 1.4). The designs promise "Synced with console" without covering the closed-window case.
- Operator vs Admin: SPEC has separate OPERATOR_PIN; the owner decision is one PIN. Update the spec so the "Operator sees no phone numbers" rule is not lost: the console shows no phones, good, but a single PIN now exposes admin phone lists to the volunteer sound operator. This is the owner's call; worth stating plainly.
- `.mov` / `.webm` promised in SRules but spec A9 says only `.mp4` plays correctly.
- Phone numbers: no public screen shows them. Children appear only as "Anika M." (good), but the full name is shown on the stage monitor in the one place (performers only) — fine, but confirm that is intended.

## 6. Could not check
Rendering, overflow, clipping (Console, Admin and GSignUp3 have fixed heights with lists and fixed bottom bars: check in render), animation, hover and focus, real contrast, safe areas, and 20 boards listed above.
