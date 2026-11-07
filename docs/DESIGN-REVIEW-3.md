# Design review 3 (round 2 boards, 69 boards)

Method: all 69 boards were read (69/69, none unreadable) by six read-only sub-readers working from the markup, each checking links, sample data, wording, sizes and my round-1 findings. I merged their reports; I did not re-open every board myself. Nothing was rendered. Contrast values are estimates from hex.
Owner decisions (SPEC Appendix D) are not re-raised.

## 1. Verdict
Big improvement. Every round-1 Must fix is addressed or overruled: dish-only, junior, partner check, errors, upload states, closed states, PIN, lockout, chooser, console login, monitor disconnected, long names, phone Live, wizard 1 to 5, empty states, dark variants all exist and match the decisions. TV text is 24px or more and the announcement is a strip. No "Staff", "arm", PIN digits or MOV. Remaining problems are mostly sample-data contradictions, dead `#` links, one rule conflict (SRules), and a few a11y gaps. None block development of the real app, but fix the data and links before handing boards to a developer.

## 2. Round-1 findings: status
| # | Finding | Status |
|---|---|---|
| Must 2 | Food-only path | Fixed (Main to GDishOnly; step 1 Perform / Dish / Both) |
| Must 3 | Junior guardian, age list | Fixed on guest boards (GSignUpJunior). Admin age-group rows use a Junior/Adult select (APeople) and a 2-option list; fine |
| Must 4 | TV text size, announcement | Fixed (Live, monitors >= 24px, strip). Exception: CMonitorFaded corner line about 3:1 (check in render); CScreens preview announcement is tiny (thumbnail) |
| Must 6 | Upload limits | Fixed (200/500 MB, MP3/WAV/M4A, MP4/WebM). But YouTube/SoundCloud link text remains in MyEntry, ALineup and SRules ("Link downloads") and AEmpty; owner kept links, so just keep them in the settings text |
| Must 7 | PIN digits | Fixed |
| Must 8 | Chooser + admin shortcuts | Fixed on GAdminChooser and Admin overview. Phone More has no Stage monitor shortcut and "Open Live" vs "Open Live screen" |
| Must 9 | Lockout, "Staff" | Fixed (GAdminPinLockout, CLogin). Titles use Admin |
| Should 1 | Done hold-to-confirm | Fixed on all console boards (no touch-hold hint) |
| Should 2 | Console consistency | Mostly fixed (inline Announcement, Screens button everywhere). Not fixed: "Vault" chip is a non-clickable span; "Open stage monitor" duplicated in header and Screens sheet and banner |
| Should 3 | Dev captions on monitor | Fixed |
| Should 4 | Phone Live | Fixed (GLivePhone) |
| Should 5 | Touch targets | Mostly fixed on phone. Desktop 28 to 40px controls; console header 36px; vault row actions 28px |
| Should 6 | Semantics/focus | NOT fixed: segmented controls still `role=radio` on `<a>` (Schedule, Food, GOffline), tabs without panels; focus-visible CSS missing on Main, SignUp, GSignUpDark/Done/Errors/Junior/Partner, GHomeDark, GDishOnly, GLivePhone; span switches/checkboxes not focusable (AFood, APeople, APayments); several primary buttons carry a permanent ring that looks like focus |
| Should 7 | Status vs Admin chip | Fixed |
| Should 8 | Public Needs track / Junior | Mostly fixed. Leaks: GLiveLongNames group named "Junior and Senior Choir"; GOffline and Schedule row 11 has no status pill while 09/10 do, which implies "needs track" |
| Should 9 | Sample-data harmony | Partly; see section 4 |
| Should 10 | Fee card states | NOT fixed: only unpaid state, no amount, link `#` |

## 3. Findings (new and remaining)
### Must fix
1. **SRules "Always shorten junior names on public screens" is a switch**, but the owner wants juniors always shortened. SPEC Appendix D lists the switch with default on, so it is consistent; confirm that off is a valid state, otherwise make it read-only. (Readers flagged this as a contradiction; treat as an owner confirmation.)
2. **Dead primary links (`#`)**: Admin overview sidebar (Lineup, People, System) and every admin desktop board; admin tabs on AData/AFood/APayments/APeople; Admin "Open lineup"; SOverviewPhone "Review" (SReadiness unreachable); SReadiness fix links; SSystem/SActivity tabs; SMore rows; AParticipantsPhone person cards (no detail board); GSignUpDone "Pay the sign-up fee"; "Add another act" on SignUp/GSignUpDark; GAdminChooser "Change it in Setup" goes to Admin, not Setup/System. Wire at least the nav and tabs so the canvas can be clicked through.
3. **Sample-data contradictions that would mislead a developer** (see section 4).
4. **A11y**: round-1 Should 6 not fixed (see table). Add `aria-current` to active nav tabs, real tabs/radios, focus-visible on all guest forms, keyboard-focusable switches.

### Should improve
1. GDishOnly slot data: Beef Curry "Taken" vs "2 open" in GSignUp3; "RICE AND MAIN 6 OPEN" shows 3 rows; Maya's Veg Biryani shows "1 open"; "Organizers only, never public" phone promise is not a decision (harmless but remove if untrue).
2. GMyDish: own dish shows "Taken" (use "Yours"); "Release dish" has no confirm; "Not you?" targets differ between GMyDish and GMyEntryDark.
3. GSignUpPartner: Continue looks enabled while it says "Choose Yes or No"; Back goes to step 1; Kannalane shown as a duet.
4. GSignUpClosed: three states on one board with contradictory copy (dish still allowed vs dish paused); label as variants.
5. GAdminPin: resting state shows 4/4 dots plus a "Sign in" button and "signs in automatically". Lockout timer inside `role=alert` will re-announce each tick.
6. CVault: row numbers wrong (two rows 12, "12 Oru Pushpam" is 15 elsewhere), act 06 "Needs cache" while Done, Thumbi Vaa "Cached" while needs track, row actions 28px spans.
7. CLongNames: filter "Group: Exton Malayali Youth Choir" with unrelated rows; playing 15 / on deck 16 do not match the row tags; CVideo acts 15 and 16 differ from CLongNames.
8. CConfirm: dialog says "Cue 09" while "Cue next" targets 08; "Cancel is selected, so Enter does nothing risky" is a designer note in UI copy. COffline: Announcement looks live while offline.
9. CReorder: no non-drag (move up/down) alternative; handles on Done/Playing rows; "Order locked" is a span with no visible unlock.
10. GOffline/Schedule/Food: Food (light) and Schedule (dark) switch theme on the same tab control.
11. Event name varies: "Sing & Serenade", "Sing & Serenade 2026", "EMA Paattukoottam / Musical Night" (Main, GHomeDark, GLivePrestart). Pick header vs title roles.
12. GHomeEnded: Live tab keeps its green dot and Sign up stays a primary tab; "See the lineup" vs "Schedule".
13. Developer notes visible/aria in guest UI: Main and GHomeDark poster chip and aria-label; GUploadError "Examples of each result".
14. Phone admin nav says "People", "Setup"; desktop "People & Potluck", "Setup & Rules". SMore "Admin sign out" vs "Sign out"; no "Downloads" on desktop.
15. APeople: introduces "Adults opt in" short names (owner said adults may opt in, ok) and a second Anika phone identical to guardian's; adults labelled "Senior" on AParticipantsPhone but "Adult" on APeople.
16. Contrast: GAdminChooser Console card subtext #FFE9E2 13px on #C84B31 about 4.0:1; admin switch-off tracks and 1px input borders #C7C1B5 about 1.8:1; lockout dots #3D4554 on #13161B.
17. Sub-12px text: 11px nav labels on most light boards, 11px eyebrows and table headers on admin boards.
18. CScreens: Motion slider lacks `aria-valuetext`; "Open stage monitor" appears twice.
19. SRules/Wizard: wizard "Performer sign-up" copy "Perform, Bring a dish, or Both" is confusing (off kills dish-only too).
20. AEmpty: sponsors copy says the reel plays "between acts" and "stays black"; check it matches the Live sponsor panel behaviour.

### Nice to have
- Footer QR on Live boards is 44px on GLiveEnded footer/GLiveOff (not scannable on a TV); the main QR on GLiveEnded and prestart is fine.
- CMonitorStandby announcement strip is plain white tint, less prominent than the amber strip on Live.
- Use neutral sample names for juniors (Anika M. is used as a real family name in wizard 4).

## 4. Sample-data consistency
Canonical (24 acts, 21 ready, 18/30, 16/27, 2 to fix, PK-001, PK-008, PK-024) holds on Overview, Lineup, Payments, Wizard 3/4/5, Readiness, Food. Contradictions found:
- Vault chip "24 of 24 ready" (Console, CConfirm, COffline, CScreens, CMonitorDisconnected) vs 3 "Needs track" rows. Should read "21 of 24".
- Live and LiveBackdrop "7 of 24 performed" while act 07 is on stage (6, or "Act 7 of 24"); GLivePhone same.
- SClearMedia "24 files, 142 MB" (21 tracks plus 2 incoming = 23).
- SSystem snapshots dated Sep 7 vs "42 days to go" to Sep 19; "Aug 28" last use. Setup progress stated as 80%, "step 2 of 5" and "steps 3 to 5 left" (SMore, SReadiness, SWizard).
- APayments: Sneha Thomas unpaid vs Paid in APeople/AParticipantsPhone. AParticipantsPhone phones differ from APeople (Arun 0108 vs 0102, Divya 0109 vs 0103, Anika 0105 vs 0106).
- GSignUpErrors: Maya "2 songs" vs 1 act. GSignUpPartner: Kannalane as a duet vs Solo (PK-001).
- Arun's dish "Samosa tray" vs "Samosa"; Anika's "Mango lassi (Drinks)" vs group "Desserts and drinks"; AFood quick-add puts Rice under Appetizers.
- SDetails date "09-19-2026 05:00PM" fine as input format; name vs sidebar "2026" differ.

## 5. Links
Every `href` target names an existing board (no missing boards). The venue and most console boards have no hrefs at all (static). Problem is dead `#` links (section 3, Must 2).

## 6. What could not be checked
Rendering (overflow flagged as "check in render": SDetails right column, SRules right column, APeople editor panel, AFood right column, APayments sticky bar over last rows, GLiveLongNames Now card, SWizard3, GSignUpDone stack), animation (ambient lights, reduced motion), real contrast, hover/focus behaviour, touch accuracy. Findings come from sub-readers' markup reads; I did not personally re-read every board.
