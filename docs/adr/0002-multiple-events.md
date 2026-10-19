# ADR 0002: Multiple events with one active event

- Status: accepted and implemented (builds on ADR 0001)

## Decision
- Every event is its own folder `<events>/<id>/` with its own `event.db`, tracks, exports and backups, so sign-ups,
  potluck claims and payments of past events are kept indefinitely.
- The **active** event is stored in `<events>/.active_event` (written atomically) and applied at runtime: the app
  re-points its storage paths, resets per-event runtime state (reconcile timer, export throttle, live-stream digest),
  re-runs bootstrap (schema, default settings, tracks, export) and every page follows without a restart. A restart
  returns to the remembered event.
- Creating an event copies rules, switches, branding and the potluck *menu* from the current (or a chosen) event, never
  sign-ups, payments or tracks. "Blank" starts from config defaults with no menu. The first-run potluck seed happens
  once per database (`sync_meta.food_seeded`), so a deliberately empty menu is never re-seeded.
- `EVENT_DIR` / `TRACKS_DIR` pin a single folder and turn switching off (for operators who map exact paths).
- **Clear media** deletes audio/video files in `tracks/` (including `_archive/`) and `incoming/` for any event, resets
  track status in that event's database, and keeps every other record. It requires typing the event id.
- Payments live on the canonical `participants` rows (`paid`, `paid_at`, `payment_note`), listed for people who sing
  (performers and partners); they survive renames and appear in the Singers sheet.
- The spreadsheet viewer and every download come from one table builder (`datasets.py`) shaped by the event type, so
  the admin view, the files in the event folder and the downloads always agree.

## Consequences
- One app instance serves one active event at a time. Run a single uvicorn worker (the default); with several workers a
  switch would only reach the worker that handled it.
- The live schedule and sign-up pages change the moment an admin switches, so the UI asks for confirmation.
- Browsers' offline vault copies and cloud sync targets are outside the app's reach when media is cleared.
