# Self-Service Sign-Up, Food Potluck, Transparency & Backup — v5

## Changes From v4

| Area | v4 | v5 (This Plan) |
|------|-----|-----|
| Event/signup config | `.env` and `config.yaml` only | **Runtime-editable from `/admin` UI** via `app_settings` DB table. Team members update without file system access. |
| Food groups | Text label on items | **First-class `food_groups` table**: editable names, drag-reorder, delete protection. Empty groups auto-hide from user pages. |
| Food serving note | Static config string | **Admin-editable text** (runtime) |
| Dashboard interactivity | Read-only | **Click-to-edit**: performer names deep-link to `/performer`, available food items have "Sign up" buttons |
| Food update workflow | Not clearly defined | **Prominent CTA card** on `/performer` page with inline food selector |
| Config architecture | Everything in env | **Hybrid**: infrastructure in `.env`, event/business rules in DB (admin-editable) |

---

## Configuration Architecture

### What stays in `.env` / `config.yaml` (infrastructure — requires restart):

| Setting | Reason |
|---------|--------|
| `GOOGLE_SHEET_URL`, Drive folder IDs | Google API credentials/targets |
| `GOOGLE_CREDENTIALS_PATH` | Service account file path |
| `ADMIN_PIN` | Security — shouldn't be changeable from the UI it protects |
| `PORT` | Networking |
| `MOCK_GOOGLE_API` | Dev/test toggle |
| `DOWNLOADER_SERVICE_URL` | Container networking |
| `CACHE_DIR`, `GALLERY_DIR` | File system paths |
| `AUDIO_BITRATE` | Transcoding setting |
| `BACKUP_DRIVE_FOLDER` | Drive folder for backups |

### What moves to Admin UI (event/business rules — live, no restart):

| Setting | Admin Section | Seed From |
|---------|--------------|-----------|
| Event name, subtitle | Event Details | `.env` / `config.yaml` |
| Event date/time, venue, time range | Event Details | `.env` / `config.yaml` |
| Event poster URL | Event Details | `.env` / `config.yaml` |
| Payment URL, signup sheet URL | Event Details | `.env` / `config.yaml` |
| Food sign-up enabled/disabled | Food Settings | `config.yaml` |
| Food serving note text | Food Settings | `config.yaml` |
| Max performances per participant | Sign-Up Rules | `config.yaml` |
| Max solo per participant | Sign-Up Rules | `config.yaml` |
| Performance types list | Sign-Up Rules | `config.yaml` |
| Age groups + guardian requirements | Sign-Up Rules | `config.yaml` |
| Entry ID prefix | Event Details | `.env` |
| Console extra columns | Display | `.env` |
| Live view sort order | Display | `.env` |

**How it works**: On first startup, the app seeds `app_settings` table from `.env`/`config.yaml`. After that, admin UI changes write directly to `app_settings` and take effect immediately. The `.env`/`config.yaml` values serve as defaults that can be overridden at runtime.

### Database Table: `app_settings`

```sql
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);
```

**Startup seed logic**:
```python
# For each configurable setting:
# If key doesn't exist in app_settings → insert from config/env
# If key already exists → keep the admin-set value (don't overwrite)
```

This means: first deploy uses config file values. Admin changes persist across restarts. If you want to force-reset a value, delete the key from the DB and restart.

---

## Food Groups: First-Class Entity

### Database Table: `food_groups`

```sql
CREATE TABLE IF NOT EXISTS food_groups (
    group_id      TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    display_order INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
);
```

### Food Items: FK to Group

```sql
CREATE TABLE IF NOT EXISTS food_items (
    item_id       TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    group_id      TEXT REFERENCES food_groups(group_id),
    display_order INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
);
```

### Group Behavior

| Scenario | Behavior |
|----------|----------|
| Group has items | Shown everywhere (dashboard, signup, performer, admin) |
| Group has no items | **Hidden from user-facing pages** (signup, performer, dashboard). Still visible in admin for management. |
| Delete group with items | **Blocked** — warning: "This group has N items. Move or delete the items first." |
| Delete empty group | Immediate delete |
| Group ordering | By `display_order` (admin drag-reorder). Default: insertion order. |
| Group name edit | Immediate update — all items in the group reflect the new name |
| New item added to group | Appears at end of that group's item list |

### Admin UI: Group + Item Management

```
┌─────────────────────────────────────────────────────────────┐
│  🍽 FOOD ITEMS                                              │
│  Serving note: [Half-Tray or Above (15+ servings)____] [✏] │
│  Toggle: Food Sign-Up [ 🟢 Enabled ]                       │
│                                                             │
│  ── Group Management ──                                     │
│  ┌─────────────────────────────────────────────────┐        │
│  │  ☰ Appetizers              3/7 taken  [✏] [🗑] │ ◀ drag │
│  │  ☰ Rice & Main             5/8 taken  [✏] [🗑] │   to   │
│  │  ☰ Curries                 5/7 taken  [✏] [🗑] │  re-   │
│  │  ☰ Breads & Sides          3/4 taken  [✏] [🗑] │  order │
│  │  ☰ Desserts                3/4 taken  [✏] [🗑] │        │
│  └─────────────────────────────────────────────────┘        │
│  [+ Add Group]                                              │
│                                                             │
│  ── Items in: Appetizers ──                 [+ Add Item]    │
│  ┌─────────────────────────────────────────────────┐        │
│  │  Veg Appetizer 1   Biny Elson          🔴 TAKEN │        │
│  │  Veg Appetizer 2   Hema                🔴 TAKEN │        │
│  │  Veg Appetizer 3   —                   🟢 OPEN  │        │
│  │  Non-Veg App. 1    Rajiv — Chicken 65  🔴 TAKEN │        │
│  │  Non-Veg App. 2    Neeta — Shrimp app  🔴 TAKEN │        │
│  │  Non-Veg App. 3    —                   🟢 OPEN  │        │
│  │  Non-Veg App. 4    —                   🟢 OPEN  │        │
│  └─────────────────────────────────────────────────┘        │
│  Each item: [Edit ✏] [Delete 🗑]                            │
│  Taken items: delete shows warning with signer name         │
└─────────────────────────────────────────────────────────────┘
```

**Admin food API** (all PIN-protected):
```
GET    /api/admin/food-groups           → all groups with item counts and sign-up stats
POST   /api/admin/food-groups           → add group { name }
PUT    /api/admin/food-groups/{id}      → edit name or display_order
DELETE /api/admin/food-groups/{id}      → blocked if has items
POST   /api/admin/food-groups/reorder   → batch update display_order

GET    /api/admin/food-items            → all items with group and sign-up info
POST   /api/admin/food-items            → add item { name, group_id }
PUT    /api/admin/food-items/{id}       → edit name, group, order
DELETE /api/admin/food-items/{id}       → warning if taken, force with ?force=true

PUT    /api/admin/food-serving-note     → { text: "Bring one dish..." }
PUT    /api/admin/food-toggle           → { enabled: true|false }
```

---

## Admin Page: Full Configuration Center

### `/admin` — End-State Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ⚙ Event Administration                     PIN: ✅ Active  │
│  ─────────────────────────────────────────────               │
│  [📝 Event Details] [🎤 Sign-Up Rules] [🍽 Food] [📊 Stats] [💾 Backup]│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📝 EVENT DETAILS                                           │
│  ┌─────────────────────────────────────────────────┐        │
│  │  Event Name:     [✨🎤 Paattukoottam ✨🎶________] │      │
│  │  Subtitle:       [Musical Night • September 19___] │      │
│  │  Event Date/Time:[09-19-2026 05:00PM_____________] │      │
│  │  Venue:          [1 Scouting Wy, Exton, PA_______] │      │
│  │  Time Range:     [5:00 PM - 9:00 PM EDT__________] │      │
│  │  Poster URL:     [/data/paattukoottam_animated.gif] │     │
│  │  Payment URL:    [_______________________________] │      │
│  │  Entry ID Prefix:[PK___]                           │      │
│  │                                                   │      │
│  │  [Save Changes ✓]        Changes apply immediately │      │
│  └─────────────────────────────────────────────────┘        │
│                                                             │
│  🎤 SIGN-UP RULES                                           │
│  ┌─────────────────────────────────────────────────┐        │
│  │  Max Performances:  [2__]                       │        │
│  │  Max Solo:          [1__]                       │        │
│  │  Performance Types: [Solo] [Duet] [Group] [+]   │        │
│  │    (click to remove, + to add custom type)      │        │
│  │                                                 │        │
│  │  Age Groups:                                    │        │
│  │  ┌──────────────────────────────────┐           │        │
│  │  │  Junior   Guardian required: ✅   │           │        │
│  │  │  Senior   Guardian required: ☐   │           │        │
│  │  └──────────────────────────────────┘           │        │
│  │  [+ Add Age Group]                              │        │
│  │                                                 │        │
│  │  [Save Changes ✓]                               │        │
│  └─────────────────────────────────────────────────┘        │
│                                                             │
│  🍽 FOOD                                                    │
│  (See food groups/items manager above)                      │
│                                                             │
│  📊 SUMMARY                                                 │
│  ┌─────────────────────────────────────────────────┐        │
│  │  Participants: 41   Performances: 48             │        │
│  │  Juniors: 26        Seniors: 22                  │        │
│  │  Solo: 36  Duet: 8  Group: 10                    │        │
│  │  Food items: 18/30 taken                         │        │
│  └─────────────────────────────────────────────────┘        │
│                                                             │
│  💾 BACKUP                                                  │
│  ┌─────────────────────────────────────────────────┐        │
│  │  Status: ✅ Last backup 2 min ago                │        │
│  │  Sheet: paattukoottam-2026_backup               │        │
│  │  [Force Backup Now]                             │        │
│  │                                                 │        │
│  │  Recent backups:                                │        │
│  │  • Sep 9, 5:30 PM — 48 rows ✅                   │        │
│  │  • Sep 9, 5:15 PM — 47 rows ✅                   │        │
│  └─────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

**Admin settings API** (PIN-protected):
```
GET  /api/admin/settings              → all current settings as key-value pairs
PUT  /api/admin/settings              → batch update { key: value, ... }
     Changes write to app_settings DB and take effect immediately.
     Broadcasts a version bump so client-side caches refresh.

GET  /api/admin/summary               → participant/performance/food stats
GET  /api/admin/backup-status         → last backup info + history
POST /api/admin/backup-now            → force immediate backup
```

---

## Dashboard: Click-to-Edit

### Song Board — Performer Names Are Links

```
┌────────────────┬──────────────┬──────────┬──────────┐
│ Performer      │ Song         │ Type     │ Track    │
├────────────────┼──────────────┼──────────┼──────────┤
│ Joshua Sohan ↗ │ Puthumazha   │ Solo     │ ⏳       │  ← link
│ Nandhini S   ↗ │ Attuthottil  │ Solo     │ ✅       │  ← link
└────────────────┴──────────────┴──────────┴──────────┘

Clicking "Joshua Sohan ↗" navigates to:
  /performer?name=Joshua+Sohan
which auto-selects that performer in the dropdown.
```

### Food Board — Available Items Have "Sign Up" Buttons

```
🟢 APPETIZERS
├─ Veg App. 1:     Biny Elson              TAKEN
├─ Veg App. 2:     Hema                    TAKEN
├─ Veg App. 3:     ──────── [Sign up →]    AVAILABLE  ← button
├─ Non-Veg App. 1: Rajiv — Chicken 65      TAKEN
├─ Non-Veg App. 2: Neeta — Shrimp app      TAKEN
├─ Non-Veg App. 3: ──────── [Sign up →]    AVAILABLE  ← button
└─ Non-Veg App. 4: ──────── [Sign up →]    AVAILABLE  ← button

Clicking [Sign up →] navigates to:
  /performer?food_item=<item_id>
which opens the food selector with that item pre-highlighted.
```

> [!NOTE]
> The dashboard remains a **public, read-only view** — no inline editing. The "links" are navigation shortcuts that take you to the performer page where the actual editing happens. This keeps the dashboard simple and avoids the complexity of editing directly on a polling page.

---

## Food Sign-Up Update Workflow

### The User's Journey: "I skipped food, now I want to sign up"

**Path 1: From the Performer page (primary path)**

When a user selects their name on `/performer` and has no food sign-up:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  🎤 PERFORMANCES (1 of 2)                               │
│  ┌─ Performance 1 ─────────────────────────────┐        │
│  │  Song: Puthumazha    [✏ Edit]               │        │
│  │  Track: ⏳ Not uploaded  [Upload]            │        │
│  └─────────────────────────────────────────────┘        │
│                                                         │
│  ┌─────────────────────────────────────────────┐        │
│  │  🍽 FOOD SIGN-UP                             │        │
│  │  ┌───────────────────────────────────────┐   │        │
│  │  │  🟡 You haven't picked a dish yet!    │   │        │
│  │  │                                       │   │        │
│  │  │  Help feed the group — pick an item   │   │        │
│  │  │  from the potluck menu.               │   │        │
│  │  │                                       │   │        │
│  │  │  [🍽 Pick a Dish]                     │   │        │
│  │  └───────────────────────────────────────┘   │        │
│  └─────────────────────────────────────────────┘        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Clicking **[🍽 Pick a Dish]** expands an inline food selector:

```
│  ┌─────────────────────────────────────────────┐        │
│  │  🍽 FOOD SIGN-UP                             │        │
│  │                                             │        │
│  │  Bring one dish to share                    │ ◀ editable
│  │                                             │   serving
│  │  🟢 Appetizers                              │   note
│  │  ├─ Veg Appetizer 1 — Biny Elson   (taken) │        │
│  │  ├─ Veg Appetizer 2 — Hema         (taken) │        │
│  │  ├─ ○ Veg Appetizer 3              OPEN    │ ◀ radio │
│  │  ├─ Non-Veg App. 1 — Rajiv         (taken) │        │
│  │  ├─ Non-Veg App. 2 — Neeta         (taken) │        │
│  │  ├─ ○ Non-Veg App. 3               OPEN    │ ◀ radio │
│  │  └─ ○ Non-Veg App. 4               OPEN    │ ◀ radio │
│  │                                             │        │
│  │  🍚 Rice & Main                             │        │
│  │  ├─ ○ Veg Fried Rice               OPEN    │        │
│  │  ├─ Non-Veg FR — Bijoymon          (taken) │        │
│  │  └─ ...                                    │        │
│  │                                             │        │
│  │  Selected: Veg Appetizer 3                  │        │
│  │  What dish? [Samosa______________]          │        │
│  │                                             │        │
│  │  [Save Food Sign-Up ✓]                      │        │
│  └─────────────────────────────────────────────┘        │
```

The user sees **all items across all groups** with taken items greyed out and available items as selectable radio buttons. They pick one, describe their dish, and save. The card then updates to show their selection with [Change] and [Remove] buttons.

**Path 2: From the Dashboard (secondary path)**

User sees an available item on the food board → clicks **[Sign up →]** → lands on `/performer?food_item=xyz` → performer page auto-opens the food selector with that item pre-selected. User just needs to select their name from the dropdown and confirm.

**Path 3: Direct from Sign-Up confirmation**

After initial registration where they skipped food, the confirmation screen says:
```
✅ You're registered!
🎤 1 Solo performance
🍽 No food sign-up yet — [Pick a dish from the Food Board →]
```

---

## Updated Component Changes

### Component 1: Config Layer

#### [MODIFY] [config.py](file:///Users/millionmax/Documents/Git/event-track-manager/app/config.py)

Add new models:
```python
class AgeGroupConfig(BaseModel):
    name: str
    requires_guardian: bool = False

class SignupConfig(BaseModel):
    food_signup_enabled: bool = True
    food_serving_note: str = "Bring one dish to share"
    age_groups: List[AgeGroupConfig] = [...]
    performance_types: List[str] = ["Solo", "Duet", "Group"]
    max_performances_per_participant: int = 2
    max_solo_per_participant: int = 1

class FoodItemSeed(BaseModel):
    name: str
    group: str

class BackupConfig(BaseModel):
    enabled: bool = True
    drive_folder_id: str = ""
    debounce_seconds: int = 10
```

Add to `AppConfig`: `signup`, `food_items_seed`, `backup`.

Add a **settings resolution helper**:
```python
def get_setting(key: str, default=None):
    """Reads from app_settings DB first, falls back to config/env."""
    from app.services.db_service import db_service
    db_val = db_service.get_app_setting(key)
    if db_val is not None:
        return db_val
    return getattr(settings, key, default)
```

---

### Component 2: Database Schema

#### [MODIFY] [db_service.py](file:///Users/millionmax/Documents/Git/event-track-manager/app/services/db_service.py)

**New tables**:

```sql
-- Runtime-editable application settings
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Food groups (first-class, admin-managed)
CREATE TABLE IF NOT EXISTS food_groups (
    group_id      TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    display_order INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
);

-- Food items (1 slot per item)
CREATE TABLE IF NOT EXISTS food_items (
    item_id       TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    group_id      TEXT REFERENCES food_groups(group_id),
    display_order INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
);

-- Food sign-ups (1 person per item, enforced by UNIQUE)
CREATE TABLE IF NOT EXISTS food_signups (
    signup_id        TEXT PRIMARY KEY,
    item_id          TEXT NOT NULL UNIQUE REFERENCES food_items(item_id),
    signer_name      TEXT NOT NULL,
    dish_description TEXT DEFAULT '',
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
);

-- Backup log
CREATE TABLE IF NOT EXISTS backup_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    triggered_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    status       TEXT DEFAULT 'pending',
    rows_backed  INTEGER DEFAULT 0,
    error_msg    TEXT
);
```

**Performance table migrations**:
```sql
ALTER TABLE performances ADD COLUMN guardian_name TEXT DEFAULT '';
ALTER TABLE performances ADD COLUMN guardian_phone TEXT DEFAULT '';
ALTER TABLE performances ADD COLUMN created_via TEXT DEFAULT 'sheet';
```

**WAL mode**: `PRAGMA journal_mode=WAL`

**New methods** (grouped):

```python
# ── App Settings ──
def get_app_setting(key) -> Optional[str]
def set_app_setting(key, value)
def get_all_app_settings() -> Dict[str, str]
def seed_app_settings(defaults: Dict)  # only inserts if key doesn't exist

# ── Food Groups ──
def get_food_groups() -> List[dict]          # with item counts + signup stats
def add_food_group(name) -> str
def update_food_group(group_id, name=None, display_order=None) -> bool
def delete_food_group(group_id) -> bool | dict  # blocked if has items
def reorder_food_groups(ordered_ids: List[str])

# ── Food Items ──
def get_food_items_by_group(group_id) -> List[dict]
def get_all_food_items_with_signups() -> List[dict]   # for dashboard/signup
def add_food_item(name, group_id) -> str
def update_food_item(item_id, name=None, group_id=None) -> bool
def delete_food_item(item_id, force=False) -> bool | dict

# ── Food Signups ──
def claim_food_item(item_id, signer_name, description) -> str | None
def update_food_signup(signup_id, item_id=None, description=None) -> bool
def release_food_signup(signup_id) -> bool
def get_food_signup_for_signer(signer_name) -> Optional[dict]

# ── Performances (new creation) ──
def create_performance(...) -> str
def update_performance_details(entry_id, **fields) -> bool
def count_performances_for_performer(name) -> dict
```

---

### Component 3: All API Endpoints

#### [MODIFY] [main.py](file:///Users/millionmax/Documents/Git/event-track-manager/app/main.py)

**New HTML routes**:
```
GET /signup      → signup.html
GET /performer   → performer hub (enhanced index.html)
GET /dashboard   → dashboard.html
GET /admin       → admin-settings.html (currently redirects to /console — change this)
GET /settings    → redirect to /admin
GET /tracks      → 301 redirect to /performer
```

> [!NOTE]
> Currently `/admin` redirects to `/console`. We change `/admin` to serve the new admin settings page. The console remains at `/console`. Both share the admin PIN cookie.

**Sign-up API** (public):
```
GET  /api/signup/config        → rules, age groups, food items/availability
POST /api/signup               → create participant + performances + optional food
PUT  /api/signup/performance/{entry_id}  → update song details
POST /api/signup/food           → claim a food item
PUT  /api/signup/food/{signup_id}  → change item or description
DELETE /api/signup/food/{signup_id} → release item
```

**Dashboard API** (public):
```
GET /api/dashboard/performances → all performances for song board
GET /api/dashboard/food         → all food groups+items+signups for food board
```

**Admin API** (PIN-protected):
```
GET  /api/admin/settings         → all current settings
PUT  /api/admin/settings         → batch update settings (immediate effect)

GET  /api/admin/food-groups      → groups with stats
POST /api/admin/food-groups      → add group
PUT  /api/admin/food-groups/{id} → edit group
DELETE /api/admin/food-groups/{id} → delete (blocked if has items)
POST /api/admin/food-groups/reorder → reorder

GET  /api/admin/food-items       → items with sign-up status
POST /api/admin/food-items       → add item
PUT  /api/admin/food-items/{id}  → edit item
DELETE /api/admin/food-items/{id} → delete (warning if taken)

PUT  /api/admin/food-serving-note → update serving note text
PUT  /api/admin/food-toggle       → enable/disable food

GET  /api/admin/summary           → event statistics
GET  /api/admin/backup-status     → backup info + history
POST /api/admin/backup-now        → force backup
```

---

### Component 4: Backup Service

#### [NEW] [backup_service.py](file:///Users/millionmax/Documents/Git/event-track-manager/app/services/backup_service.py)

Unchanged from v4. Async loop, debounced, WAL-safe snapshots. Writes to Google Sheet in backup Drive folder.

---

### Component 5: Frontend Files

#### New Files

| File | Purpose |
|------|---------|
| [signup.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/signup.html) | New participant registration |
| [signup.js](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/js/signup.js) | Sign-up page logic |
| [dashboard.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/dashboard.html) | Public transparency board |
| [dashboard.js](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/js/dashboard.js) | Dashboard logic + click-to-edit links |
| [admin-settings.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/admin-settings.html) | Admin configuration center |
| [admin-settings.js](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/js/admin-settings.js) | Admin page logic (settings CRUD, food management, stats, backup) |

#### Modified Files

| File | Changes |
|------|---------|
| [index.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/index.html) | Rebrand as Performer Hub, inline song edit, food CTA card + selector, others' songs section |
| [intake.js](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/js/intake.js) | Song edit, food selector, others' songs, deep-link query param handling (`?name=`, `?food_item=`) |
| [landing.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/landing.html) | 6 nav cards: Sign Up, Performer, Dashboard, Live, Console, Admin |
| [live.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/live.html) | Updated nav bar |
| [admin.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/admin.html) | Updated nav bar (Admin link goes to /admin, this page stays at /console) |

---

## Complete File Change Summary

| Action | File | Description |
|--------|------|-------------|
| MODIFY | [config.yaml](file:///Users/millionmax/Documents/Git/event-track-manager/config.yaml) | `signup` rules, `food_items_seed` (30 items, 5 groups), `backup` |
| MODIFY | [.env.example](file:///Users/millionmax/Documents/Git/event-track-manager/.env.example) | New env vars |
| MODIFY | [.env](file:///Users/millionmax/Documents/Git/event-track-manager/.env) | New config values |
| MODIFY | [config.py](file:///Users/millionmax/Documents/Git/event-track-manager/app/config.py) | New Pydantic models + settings resolution helper |
| MODIFY | [db_service.py](file:///Users/millionmax/Documents/Git/event-track-manager/app/services/db_service.py) | WAL, `app_settings`, `food_groups`, `food_items`, `food_signups`, `backup_log`, CRUD methods |
| MODIFY | [main.py](file:///Users/millionmax/Documents/Git/event-track-manager/app/main.py) | Routes + ~25 API endpoints |
| MODIFY | [google_service.py](file:///Users/millionmax/Documents/Git/event-track-manager/app/services/google_service.py) | Sheet write methods for backup |
| NEW | [backup_service.py](file:///Users/millionmax/Documents/Git/event-track-manager/app/services/backup_service.py) | Async backup loop |
| NEW | [signup.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/signup.html) | Registration page |
| NEW | [signup.js](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/js/signup.js) | Sign-up logic |
| NEW | [dashboard.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/dashboard.html) | Transparency board |
| NEW | [dashboard.js](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/js/dashboard.js) | Dashboard + click-to-edit |
| NEW | [admin-settings.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/admin-settings.html) | Admin configuration center |
| NEW | [admin-settings.js](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/js/admin-settings.js) | Admin settings + food CRUD |
| MODIFY | [index.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/index.html) | Performer Hub + food CTA + song edit |
| MODIFY | [intake.js](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/js/intake.js) | Song edit, food, deep-links |
| MODIFY | [landing.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/landing.html) | 6 nav cards |
| MODIFY | [live.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/live.html) | Nav bar update |
| MODIFY | [admin.html](file:///Users/millionmax/Documents/Git/event-track-manager/app/static/admin.html) | Nav bar update |

---

## Verification Plan

### Automated Tests
```bash
pytest tests/test_api.py tests/test_config.py tests/test_audio_service.py  # regression
pytest tests/test_signup_api.py          # registration + constraints
pytest tests/test_performance_edit.py    # inline song updates
pytest tests/test_food_signup.py         # claim/release, race condition, UNIQUE constraint
pytest tests/test_food_admin.py          # group + item CRUD, delete protection
pytest tests/test_admin_settings.py      # runtime settings, seed logic, override behavior
pytest tests/test_dashboard_api.py       # public board endpoints
pytest tests/test_backup_service.py      # debounce, snapshot, Sheet write
```

### Manual Verification
1. **Import existing data**: Start app → all 48 performances + 30 food items from Sheet appear
2. **Admin settings**: `/admin` → change event name → verify landing page updates immediately (no restart)
3. **Admin food groups**: Add group "Snacks" → add item "Chips" → delete group (blocked if items exist) → move item → delete empty group
4. **Admin food serving note**: Change "Half-Tray..." to "Bring one dish" → verify text updates on signup/performer pages
5. **Junior sign-up**: Name, Junior, guardian → register → verify in dashboard
6. **Solo constraint**: Add 2nd performance → Solo disabled after first
7. **Song edit from performer**: Select name → Edit → change song → Save
8. **Food sign-up from performer**: No food → see yellow CTA card → click "Pick a Dish" → select item → Save → card shows selection
9. **Dashboard click-to-edit**: Click performer name → navigates to `/performer?name=...` with that person selected
10. **Dashboard food sign-up**: Click "Sign up →" on available item → navigates to `/performer?food_item=...`
11. **Food race condition**: Two browsers → both try to claim same item → one gets 409
12. **Backup**: Make changes → wait 15s → check Drive → verify Sheet
13. **Existing flows**: Console playback, live view, track upload — all unchanged
14. **Backward compat**: `/tracks` → 301 → `/performer`; `/admin` now serves settings (console stays at `/console`)
