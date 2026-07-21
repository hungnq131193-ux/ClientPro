# MANDATORY STARTUP PROTOCOL — READ CLAUDE.md FIRST

Before inspecting, editing, testing, reviewing, or planning work in this
repository, every agent MUST read this entire CLAUDE.md file.

CLAUDE.md is the canonical project map, architecture guide, safety contract,
and operating procedure for ClientPro.

Do NOT scan or read the entire codebase by default.

Read source code only when the current task requires deeper understanding,
verification, debugging, or modification of a specific module.

Start with the files identified in this document, inspect only directly
relevant dependencies, and stop when enough information has been gathered to
complete the task safely.

Do not broaden the scope, search for unrelated improvements, or inspect
unrelated modules without a concrete reason tied to the user's request.

---

## 0. How to use this document (operating rules for agents)

1. **Read the whole file first.** Do not act on a user prompt alone before you
   have read CLAUDE.md.
2. **Do not read the whole codebase by default.** This document is designed so
   that most tasks can start without re-surveying the repository.
3. **Read source code only when** you need to:
   - understand a module more deeply than this map explains,
   - verify that documentation matches the code,
   - modify a specific module,
   - debug a concrete behavior,
   - check the direct impact of a change you are making.
4. **When you do read code:**
   - open only the files directly related to the task,
   - follow only the dependencies you actually need,
   - stop as soon as you have enough information.
5. **Never use "surveying the codebase" as a reason to widen scope** — no
   opportunistic bug-hunting, refactoring, or inspecting unrelated modules.
6. **If documentation and code disagree:** do not guess. Open the relevant file,
   determine the real state, and update the documentation only within the
   allowed scope. Do not change application logic to make the docs "true."
7. **If a request conflicts with a security or data invariant:** stop, state the
   conflict explicitly, and do not proceed on your own.
8. **Never merge a Pull Request** unless the user explicitly asks for it.
9. **After any change to architecture, an invariant, or a procedure, update
   CLAUDE.md** in the same change so this map stays canonical.

Reference code by **file name + function name**, never by hard line numbers.
Source code and `index.html` are the final source of truth.

---

## 1. Project identity

- **Name:** ClientPro.
- **Public release name:** `Genesis` (public label only; not shown in the app UI).
- **App version (semver):** single source of truth is `package.json` → `version`.
  This is an internal technical number for tooling/cache sync and is not shown to
  end users. Do not read the version from any other file — read `package.json`.
- **What it is:** a **mobile-first PWA** for managing **customers** and
  **collateral assets**, optimized for Android Chrome in standalone mode.
- **Stack:** **vanilla JavaScript + HTML + CSS**, zero runtime dependency, **no
  build step**. Dependencies and fonts are self-hosted. Deployed as a static site
  (Vercel).

## 2. Purpose of ClientPro

Give a field credit officer a fast, private, offline-capable tool to record and
look up customer files and their collateral assets on a phone: profiles, notes,
credit limits, valuations, photos, map locations, road distance, on-device PDF
utilities, and encrypted backup/restore.

## 3. Intended users

Individual credit/relationship officers using a personal phone. The app is
single-user per device: one activation, one PIN, local data. It is not a
multi-tenant server product and does not replace any core banking system.

## 4. What ClientPro does and does not do

**Does:**
- Store customer and collateral records locally, encrypted at rest.
- Capture, store, view, and share photos tied to a customer/asset.
- Show customers on a map and compute road distance.
- Provide on-device PDF tools (merge, split, reorder, images→PDF, PDF→images,
  compress).
- Back up / restore, optionally to the user's own Google Drive, and transfer a
  backup to another user via Google Apps Script.
- Work offline as an installed PWA.

**Does not:**
- Send business data to any server the user did not explicitly opt into.
- Provide analytics, tracking, ads, or third-party CDNs.
- Act as a bank/core system of record or a shared multi-user database.
- Upload PDFs anywhere — PDF Toolkit is fully on-device.

## 5. Offline-first principle

Business data lives on the device (IndexedDB). The Service Worker precaches the
app shell and self-hosted dependencies so the app opens and works without a
network. Network is used only for user-initiated cloud actions (Drive/GAS),
map tiles, routing, and weather.

## 6. Privacy-first principle

Sensitive fields and images are encrypted with WebCrypto (AES-256-GCM) before
they enter IndexedDB. The master key is sealed under the user's PIN (PBKDF2) and
exists only in RAM while unlocked. `localStorage` holds only configuration,
sealed envelopes, markers, and sealed caches — never a plaintext master key or
KDATA. Ciphertext must never be shown in the UI.

## 7. Tech stack (actual)

| Area | Technology |
|---|---|
| Frontend | Vanilla JavaScript, HTML5, CSS3 (no framework, no bundler) |
| Storage | IndexedDB, `localStorage` |
| Encryption | WebCrypto AES-256-GCM, PBKDF2-SHA256 |
| Biometrics | WebAuthn PRF |
| Map | MapLibre GL, Supercluster, OSRM (routing) |
| PDF | pdf-lib, pdf.js, JSZip (all self-hosted, lazy-loaded) |
| PWA | Service Worker + Web App Manifest |
| Cloud (opt-in) | Google Drive, Google Apps Script |
| Hosting | Vercel static |
| Tests | Node built-in test runner, Playwright, axe, Lighthouse CI |

## 8. Overall architecture

A single `index.html` app shell loads a fixed, ordered list of plain `<script>`
modules under `assets/`. Each module owns one business layer and exposes globals
(functions and a few `window.*` namespaces) consumed by later modules. There is
no module bundler and no ES-module graph for the app itself (PDF vendor libs are
the exception: pdf.js is loaded as an ES module on demand). UI is composed from
static markup in `index.html` plus HTML modal fragments loaded at runtime.

## 9. App bootstrap sequence

The script order in `index.html` is the authoritative execution order:

```
ui/load_modals → 00_globals → 01_config → 02_security → 12_backup_core →
13_ui_select_customers → 15_auth_gate → 03_map → 04_ui_common → 19_error_loading →
05_customers → 06_assets → 08_images_camera → 09_menu → 09_backup_manager →
09_donate → 09_weather → 07_drive → 14_cloud_transfer → 16_auto_backup_drive →
17_onboarding_tour → 18_biometric_unlock → 10_bootstrap → 11_edge_back_swipe → pwa.js
```

`10_bootstrap.js` opens IndexedDB and starts the app; `pwa.js` registers the
Service Worker last. If you add or reorder a module, update this list.

## 10. Directory structure (architecture level)

```
index.html                App shell + authoritative script load order + all ?v= tags
sw.js                     Service Worker: precache list, VERSION, ASSET_V, CACHE_EPOCH
manifest.json             Web App Manifest (name, icons, version)
vercel.json               Security headers + CSP
package.json              Semver single source of truth + CI/test scripts
scripts/sync-version.mjs  Sync/verify semver + ASSET_V across manifest/sw/pwa/README
assets/00…19_*.js, pwa.js Business modules, in dependency order (see §9)
assets/head.js            Early head-level setup
assets/pdf-toolkit/*.js   PDF Toolkit (utils/core/ui + tool modules)
assets/ui/load_modals.js  Loads the modal HTML fragments
assets/ui/modals/*.html   Modal fragments (activation, lock, backup, camera, etc.)
assets/vendor/            Self-hosted deps (crypto-js, lucide, maplibre, supercluster, pdf-lib, pdf.js, jszip)
assets/fonts/             Self-hosted fonts (Be Vietnam Pro, Inter)
assets/styles.css, css/   App CSS (styles.css + css/{fonts,tailwind.clientpro,app.patch,redesign.clientpro}.css)
gas/                      Google Apps Script: AdminAPI.gs, UserDriveAPI.gs
tests/                    Node unit tests (node --test)
e2e/                      Playwright + axe specs
docs/                     terminology.md + screenshots
.github/workflows/ci.yml  CI: JSON validate, node --check, version sync, tests, e2e
```

## 11. Script load-order rule

Every business script is included in `index.html` with a `?v=<ASSET_V>` query and
executes in the order shown in §9. The order encodes real dependencies (security
before anything that decrypts; error/loading helpers before UI modules; bootstrap
near the end). Do not reorder without verifying the dependency chain.

## 12. Global namespace

Modules share state and helpers through globals rather than imports. Key
`window.*` namespaces and helpers (authoritative names — verify a signature in
source before relying on it):

- Helpers: `getEl`, `el` (safe DOM builder in `04_ui_common.js`), `showToast` /
  `showSuccess` / `showWarning` / `showError`, `showConfirm`.
- Managers: `window.ErrorHandler`, `window.LoadingManager`, `window.Haptics`,
  `window.AppToast`.
- Feature namespaces: `window.AuthGate`, `window.BackupCore`,
  `window.DriveBackup`, `window.CloudTransferUI`, `window.UISelectCustomers`,
  `window.BiometricUnlock`, `window.PdfToolkit`, `window.OnboardingTour`.
- Shared crypto state lives as module-level globals in `02_security.js`
  (`masterKey`, `masterCryptoKey`, caches). Treat these as read-only outside
  security/unlock code.

## 13. Public API / important entry points

- `data-action` delegation (`00_globals.js`): static markup uses
  `data-action="name"` (optionally `data-arg="…"`); a global click/change
  listener maps names to functions in explicit `CLICK_ACTIONS` / `CHANGE_ACTIONS`
  tables. There are no inline `onclick` handlers (required by CSP). New static
  actions must be registered in these tables.
- Unlock event: `document` dispatches `clientpro:unlocked` after a successful
  unlock and data load.
- Namespace entry points such as `PdfToolkit.open()`, `BiometricUnlock.openSetup()`,
  `DriveBackup.performNow()`, `OnboardingTour.replay()`.

---

## Activation

### Purpose
Gate app usage behind a device activation record before any data flow.

### Core invariants
- Do not bypass, weaken, or auto-complete activation.
- Do not persist activation secrets/tokens as plaintext beyond what the existing
  code already stores.

### Primary files
`assets/15_auth_gate.js`, `assets/ui/modals/activation-modal.html`,
`gas/AdminAPI.gs`.

### Public entry points
`activateApp()` (via `data-action="activateApp"`); auth-gate logic in
`window.AuthGate`.

### Data and lifecycle
Activation state and identifiers live in `localStorage` (e.g. `app_activated`,
`app_employee_id`). The auth gate decides between activation, lock, and normal
start at load.

### Read source code only when
You must verify the gate order, an activation bug is reported, or you are
explicitly changing activation UI copy (docs/tour only — never logic).

### Usually unnecessary to inspect for
Documentation, tour content, README, or version work.

### Required tests when changed
Activation is out of scope for documentation/tour work; if it must change, run
`npm test` and full `npm run test:e2e`, especially `crud.spec.js` and
`autolock.spec.js`.

### Must not affect
PIN/unlock, encryption, IndexedDB, backup.

## PIN / app lock

### Purpose
Lock the app and require a PIN (or biometric) to unlock; auto-lock when hidden.

### Core invariants
- Never skip the PIN gate. `lockApp()` must clear key material before showing the
  lock screen.
- Async work must account for an auto-lock landing between two `await`s.

### Primary files
`assets/02_security.js` (`lockApp`, `showLockScreen`, `validatePin`,
`enterPin`), `assets/ui/modals/screen-lock.html`,
`assets/ui/modals/setup-lock-modal.html`.

### Public entry points
`enterPin(n)`, `clearPin()`, `backspacePin()`, `lockApp()`, `forgotPin()`.

### Data and lifecycle
The lock screen is `#screen-lock`; visibility toggles with the `hidden` class
(not `display:none`). The PIN envelope is stored under the PIN key in
`localStorage`.

### Read source code only when
Debugging unlock, verifying lock cleanup, or checking whether a feature reacts to
lock (e.g. the tour observes `#screen-lock`).

### Usually unnecessary to inspect for
Docs, README.

### Required tests when changed
`npm test`, `e2e/autolock.spec.js`, `e2e/crud.spec.js`.

### Must not affect
Encryption schema, IndexedDB, tour data.

## Unlock lifecycle

### Purpose
Turn a valid PIN into an in-RAM master key and load data.

### Core invariants
- Valid unlock path: `validatePin` → `_installMasterKey` →
  `completeUnlockDataLoad` (runs migration, primes cache, flushes pending KDATA,
  loads data, dispatches `clientpro:unlocked`).
- Do not reorder or short-circuit this path.

### Primary files
`assets/02_security.js`.

### Public entry points
`clientpro:unlocked` event (consumed by `16_auto_backup_drive.js` and others).

### Data and lifecycle
`masterKey`/`masterCryptoKey` are set only after a successful unlock and cleared
on lock.

### Read source code only when
Debugging unlock ordering or a "data not decrypted after unlock" issue.

### Usually unnecessary to inspect for
Docs, tour UI (the tour only checks that `masterKey` exists and the lock screen
is hidden).

### Required tests when changed
`npm test`, full `npm run test:e2e`.

### Must not affect
Anything — this is a forbidden area for documentation/tour work.

## Encryption / masterKey

### Purpose
Encrypt sensitive fields and images at rest with AES-256-GCM.

### Core invariants
- Encrypted customer fields: `name`, `phone`, `cccd`, `notes`, `creditLimit`,
  `driveLink`.
- Encrypted asset fields: `name`, `link`, `valuation`, `loanValue`, `area`,
  `width`, `onland`, `year`, `driveLink`.
- Before writing an encrypted field, confirm it looks encrypted
  (`_looksEncrypted`) before entering the transaction.
- To get guaranteed plaintext: `await decryptFieldAsync(value)`.
- Never write an empty fallback on decrypt failure, never double-encrypt, never
  render ciphertext (use `_displayPlain` / `_displayPlainAsync`; show a
  placeholder for ciphertext). Do not hard-code the ciphertext prefix.

### Primary files
`assets/02_security.js`.

### Public entry points
`encryptText`, `decryptText`, `decryptFieldAsync`, `encryptImageData`,
`decryptImageData`.

### masterKey lifecycle
Generated/sealed under PIN (PBKDF2), installed on unlock, held only in RAM,
cleared on lock. Never persisted as plaintext.

### Read source code only when
Debugging a crypto/migration bug or verifying a field list — never to "improve"
crypto.

### Usually unnecessary to inspect for
Docs, tour, README.

### Required tests when changed
`npm test` (`tests/crypto.test.js`, `tests/field-migration.test.js`,
`tests/data-integrity.test.js`), full e2e.

### Must not affect
Backup format, IndexedDB schema.

## Ciphertext rules

Ciphertext must never reach the UI. Rendering paths must decrypt or show a
placeholder. Do not log plaintext of sensitive fields. Do not infer or hard-code
the encryption prefix in new code — use the provided helpers.

## IndexedDB

### Purpose
Local, offline, primary store for business data.

### Core invariants
- Database `QLKH_Pro_V4`, schema **version 5**. Do not change the DB name or bump
  the schema version for documentation/tour work.
- Object stores: `customers`, `images`, `backups` (all `keyPath: "id"`).
- Snapshot IDs/state before an `await` chain; never `await` WebCrypto or I/O in
  the middle of a transaction; confirm commit via `tx.oncomplete` (not
  `request.onsuccess`); handle `oncomplete`/`onerror`/`onabort`.

### Primary files
`assets/10_bootstrap.js` (`indexedDB.open`, store creation, app start).

### Public entry points
Global `db` handle; `window.__dbReady`.

### Read source code only when
Debugging a storage bug or verifying store/schema facts.

### Usually unnecessary to inspect for
Docs, tour, README.

### Required tests when changed
`npm test` (`tests/schema.test.js`, `tests/data-integrity.test.js`).

### Must not affect
Crypto schema, backup format.

## Data ownership

All business data is owned by the user and stored on the device. Clearing site
data deletes IndexedDB. There is no server-side authoritative copy; cloud actions
are user-initiated backups only.

## Customer data model (contract level)

A customer record (`keyPath: "id"`) carries at least: identity/contact fields
(`name`, `phone`, `cccd`), `notes`, `creditLimit`, `driveLink`, a status used to
split "approved" vs "pending", a `cryptoV` marker, and related assets. Sensitive
fields are stored encrypted (see Encryption). Treat the exact shape as defined by
`05_customers.js` + `02_security.js`; do not redesign it.

## Collateral (asset) data model (contract level)

An asset record carries at least: `name`, `link`, `valuation`, `loanValue`,
`area`, `width`, `onland`, `year`, `driveLink`, and coordinates for the map.
Sensitive fields are stored encrypted. Authoritative shape lives in
`06_assets.js` + `02_security.js`.

## Images / camera

### Purpose
Capture/store/view/select/share photos tied to a `customerId`/`assetId`.

### Core invariants
- Image `data` is encrypted at rest (see `encryptImageData`/`decryptImageData`).
- Do not weaken image encryption or leak plaintext data URLs.

### Primary files
`assets/08_images_camera.js`, `assets/ui/modals/camera-modal.html`.

### Public entry points
`capturePhoto()`, gallery/lightbox actions, `shareSelectedImages()`,
`deleteSelectedImages()`.

### Read source code only when
Debugging capture/gallery or verifying encryption of image data.

### Required tests when changed
`npm test`, relevant e2e.

### Must not affect
Crypto schema, IndexedDB stores.

## Google Drive integration

### Purpose
Optional, user-initiated upload of images/backups to the user's own Drive.

### Core invariants
- Opt-in only; no automatic upload of business data beyond the auto-backup flow
  the user configured.
- Do not commit tokens/secrets; do not add new endpoints.

### Primary files
`assets/07_drive.js`, `assets/16_auto_backup_drive.js`, `gas/UserDriveAPI.gs`.

### Read source code only when
Debugging Drive upload/config — never for docs/tour.

### Must not affect
Crypto, backup format, GAS endpoints.

## Google Apps Script integration

### Purpose
Server-side glue the user opted into: device activation + KDATA (AdminAPI) and
personal Drive storage (UserDriveAPI).

### Core invariants
Do not change endpoints, tokens, or protocol. Do not commit secrets.

### Primary files
`gas/AdminAPI.gs`, `gas/UserDriveAPI.gs`, `assets/14_cloud_transfer.js`.

### Read source code only when
Explicitly working on cloud transfer/activation logic (out of scope for
docs/tour).

## Backup / restore / export / import

### Purpose
Create encrypted backups (in-app store, file, Drive, cloud transfer) and restore
them safely.

### Core invariants
- Backup runs only when unlocked with valid KDATA.
- Export decrypts async and stops if ciphertext remains.
- Restore re-encrypts with the destination device key and stops on encrypt
  failure.
- All restore entry points go through a global mutex; inbox restore is idempotent
  and deletes remote only after a successful restore.
- Delete/restore must have an in-flight guard and must not use
  `location.reload()` to hide errors.

### Primary files
`assets/12_backup_core.js`, `assets/09_backup_manager.js`,
`assets/14_cloud_transfer.js`, `assets/16_auto_backup_drive.js`,
`assets/13_ui_select_customers.js`.

### Public entry points
`createBackupFileNow()`, `openBackupManager()`, `restoreData()`,
`window.BackupCore`, `window.DriveBackup`.

### Read source code only when
Debugging backup/restore — never for docs/tour.

### Required tests when changed
`npm test` (`tests/backup.test.js`), full e2e.

### Must not affect
Crypto schema, IndexedDB schema.

## MapLibre / OSRM

### Purpose
Show customers on a map with clustering and compute road distance.

### Core invariants
- MapLibre is lazy-loaded with its own cache-buster `MAPLIBRE_V`, which must equal
  `ASSET_V`.
- Do not change clustering/routing logic for docs/tour.

### Primary files
`assets/03_map.js`.

### Public entry points
`toggleMap()`, `locateMe()`, `getCurrentGPS()`.

### Read source code only when
Debugging the map/distance or syncing `MAPLIBRE_V` during a version bump.

### Must not affect
Distance calculation, tile caching strategy.

## PDF Toolkit

### Purpose
On-device PDF utilities; nothing is uploaded.

### The six tools
1. **Ghép PDF** (`merge`, `pdf_toolkit_merge.js`) — join several PDFs into one.
2. **Tách PDF** (`split`, `pdf_toolkit_pages.js`) — extract pages by range/selection.
3. **Sắp xếp trang** (`organize`, `pdf_toolkit_pages.js`) — reorder, rotate, delete
   pages.
4. **Ảnh thành PDF** (`img2pdf`, `pdf_toolkit_images.js`) — JPG/PNG/WebP → PDF.
5. **PDF thành ảnh** (`pdf2img`, `pdf_toolkit_pdf2img.js`) — PDF pages → PNG/JPEG.
6. **Nén PDF** (`compress`, `pdf_toolkit_compress.js`) — reduce PDF size.

### Limits (from `pdf_toolkit_utils.js` `PDF_TOOLKIT_LIMITS`)
- Max files per operation: **30**.
- Total size: **warn at 30 MB, hard block at 100 MB**.
- Pages: **warn at 150, hard block at 500**.
- Per image: **24 MP** max.

### Memory principles
- Vendor libs (pdf-lib, pdf.js, JSZip) are lazy-loaded on first use.
- Object URLs are tracked in a registry and revoked; large buffers are released;
  operations are cancellable with progress; each tool registers cleanup.
- No PDF or page content leaves the device.

### Primary files
`assets/pdf-toolkit/pdf_toolkit_utils.js` (pure, unit-tested),
`pdf_toolkit_core.js` (vendor lazy-load, validation, object-URL registry,
download/share/ZIP), `pdf_toolkit_ui.js` (screen `#screen-pdf-toolkit`,
navigation, progress/cancel, cleanup, `window.PdfToolkit`), plus the tool files
above.

### Public entry points
`PdfToolkit.open()`, `window.pdfToolkitHandleBack`.

### Read source code only when
Debugging a PDF tool or verifying a limit.

### Required tests when changed
`npm test` (`tests/pdf-toolkit-utils.test.js`), `e2e/pdf-toolkit.spec.js`.

### Must not affect
App crypto, IndexedDB, Service Worker strategy.

## Service Worker / PWA

### Purpose
Installable PWA with offline app shell.

### Core invariants
- `install` does not force activation; `activate` keeps only the current
  allowlisted caches.
- Cache names: `clientpro-genesis-{static,runtime-so,runtime-cdn,runtime-tile}-<VERSION>`.
- `ASSET_V` (cache-buster) must equal every `?v=` in `index.html` and `MAPLIBRE_V`.
- Do not change the caching strategy or add a CDN.

### Primary files
`sw.js` (`VERSION`, `ASSET_V`, `CACHE_EPOCH`, precache list, fetch handlers),
`assets/pwa.js` (registration + update flow, `SW_BUILD`), `manifest.json`.

### Read source code only when
Debugging offline/update behavior or performing a version bump.

### Required tests when changed
`npm test` (`tests/sw-routing.test.js`, `tests/pwa.test.js`), `node --check sw.js`,
`e2e/offline.spec.js`.

### Must not affect
Runtime caching strategy, IndexedDB.

## Offline cache

The precache list in `sw.js` covers the app shell, self-hosted vendor scripts,
CSS, and fonts, each tagged with `?v=<ASSET_V>`. Runtime caches serve same-origin
assets, same-origin vendor files, and map tiles under separate cache buckets.
Keep the precache list and the `?v=` tags in `index.html` in lockstep with
`ASSET_V`.

## UI architecture

Static screens live in `index.html`; modal fragments live in
`assets/ui/modals/*.html` and are injected by `assets/ui/load_modals.js`
(`clientpro:modals-loaded` fires when done). Dynamic DOM is built with the safe
`el()` helper and `textContent` — never `innerHTML` with dynamic data. Icons are
Lucide (self-hosted). Buttons wire behavior through `data-action`.

## Theme

Multiple themes are selectable from the settings menu via
`data-action="setTheme"` with a `data-arg` theme id (e.g. `theme-vietinbank`,
`theme-midnight`, `theme-ocean`, `theme-aurora`). A theme sets CSS custom
properties (e.g. `--accent-gradient`) consumed across the UI. Do not change the
theme system for docs/tour work.

## Modals and overlays

Business modals use the shared overlay/modal frame (`04_ui_common.js`), the
standard confirm (`showConfirm`), and `ModalA11y` behavior from
`19_error_loading.js`. Do not modify existing modal stacking to accommodate a
local flow.

## Z-index contract

| Layer | z-index |
|---|---:|
| Content | 0–50 |
| Menu / map / gallery / camera | 50–100 |
| Business modal | 200 |
| Global loader | 250 |
| Lock / activation | 300–350 |
| Toast | 400–500 |
| Confirm | 600 |
| Onboarding tour | 1000+ (overlay 1000, spotlight 1001, card 1002) |

Do not raise a global z-index for a local flow.

## Edge back-swipe

### Purpose
Android-style edge swipe to go back / close the topmost overlay.

### Core invariants
- Claims a gesture only after the drag direction is confirmed.
- Do not alter global edge-back or history behavior for docs/tour.
- CI blocks any debug scaffold in this file (`DEBUG_MODE`, debug log keys, `dbg(`).

### Primary files
`assets/11_edge_back_swipe.js`.

### Read source code only when
Debugging back/gesture behavior or verifying that a new overlay interacts
correctly (the tour does not register as a modal and does not push history).

### Must not affect
Existing history/back behavior.

## Browser history

The app manages its own back behavior via `11_edge_back_swipe.js` and
`handleAppBack`. The onboarding tour must not push history entries; hardware/edge
back must not leave ghost history entries attributable to the tour.

## LoadingManager / ErrorHandler

### Purpose
Single, standardized loading and error surfaces.

### Core invariants
Use `window.LoadingManager` (`startLoading`, …) and `window.ErrorHandler`
(`logError`, `showError`) — do not create ad-hoc loaders/toasts. Do not use
native `alert`/`confirm`/`prompt`.

### Primary files
`assets/19_error_loading.js`.

### Must not affect
Anything else — these are shared infrastructure; the tour must not modify them.

## Confirm / standard modal

Use `showConfirm(...)` for confirmations (renders the `.cp-confirm-*` overlay).
Never use native dialogs.

## DOM safety

Inject dynamic data with `textContent`, DOM APIs, and URL guards. Build elements
with `el()`. Never assign dynamic data to `innerHTML`.

## CSP

CSP and security headers live in `vercel.json`. `script-src` excludes
`unsafe-inline` (hence the `data-action` delegation instead of inline handlers).
Do not loosen CSP or add external hosts. CI fails if a CDN reference appears in
`index.html`, `vercel.json`, or CSS/JS.

## XSS prevention

No `innerHTML` with dynamic data, no inline event handlers, URL guards on
user-controlled links. All new UI must follow the same rules.

## No `innerHTML` with dynamic data

This is an absolute rule. Static, developer-authored HTML fragments are loaded via
`load_modals.js`; anything data-driven is built with `el()`/`textContent`.

## Event handler rule

Static markup uses `data-action` registered in `00_globals.js`. Dynamically
created elements attach listeners in JS (e.g. `el(..., { on: { click } })` or
direct `addEventListener`). No inline `onclick`.

## localStorage / sessionStorage

`localStorage` holds only config, sealed envelopes, markers, and sealed caches —
never a plaintext master key or KDATA. Tour state uses its own clearly named key.
`sessionStorage` holds transient markers (e.g. the SW reload guard). Do not store
sensitive plaintext.

## Tour / onboarding

### Purpose
A short, mobile-first, first-run guided tour of the dashboard, plus a manual
replay entry.

### Core invariants
- Show automatically only to genuinely new users; never force existing users to
  re-watch after an update.
- Never create sample customers/assets/backups; never touch business data,
  IndexedDB schema, or crypto.
- Build UI with `el()`/`textContent`; no `innerHTML` with dynamic data, no native
  dialogs, no inline handlers, no global z-index changes.
- Clean up fully on skip/finish/close/app-lock/screen-close; leave no ghost
  overlay, listener, observer, timer, or history entry.
- If a step's target selector is missing, skip that step safely (no crash, no
  hang, no leftover overlay). Steps with no target are intentional centered cards
  (welcome/finish/replay hint).

### Primary files
`assets/17_onboarding_tour.js`; tour CSS lives in the `ONBOARDING TOUR` section of
`assets/styles.css` (`.tour-*`). The manual replay entry is a menu button in
`index.html` wired through `00_globals.js` (`OnboardingTour.replay`).

### Public entry points
`window.OnboardingTour.start()` and `window.OnboardingTour.replay()`
(replay = start regardless of completion state, closing the menu first).

### Data and lifecycle
- New-user detection: `localStorage` key `clientpro_onboarding_done` storing
  `{ version, completedAt }`. Auto-show when the key is absent or its stored
  `version` is below the module's `TOUR_VERSION`; finishing/skipping writes the
  key.
- Auto-start waits for the dashboard (`#customer-list`), a set `masterKey`, and a
  hidden lock/activation/setup screen before showing.
- A `MutationObserver` on `#screen-lock` detects app-lock and tears the tour down
  (without marking complete), and it does not reopen after unlock.

### Read source code only when
Editing tour steps/behavior, verifying a dashboard selector, or debugging tour
cleanup.

### Usually unnecessary to inspect for
Any business module — the tour only reads the dashboard DOM and the `masterKey`
global; it does not import business logic.

### Required tests when changed
`e2e/onboarding-tour.spec.js`, plus `npm test` and `node --check` on the file.

### Must not affect
Activation, unlock, crypto, IndexedDB, backup, business screens, modal stacking,
global z-index, edge-back/history, LoadingManager/ErrorHandler.

## Versioning

### Purpose
Keep one semver and one asset cache-buster consistent everywhere.

### Core invariants
- `package.json` `version` is the single semver source of truth.
- `ASSET_V` in `sw.js` is the asset cache-buster (free-form tag).
- Do not confuse app version with IndexedDB schema version, crypto version, or
  backup format version — these are independent.

### Primary files
`package.json`, `sw.js`, `scripts/sync-version.mjs`, `manifest.json`,
`assets/pwa.js`, `README.md`, `index.html`, `assets/03_map.js`.

### Data and lifecycle
`npm run sync:version` writes semver + `ASSET_V` into `manifest.json`, `sw.js`
`VERSION` (`v<semver>`), `assets/pwa.js` `SW_BUILD`, and `README.md`.
`npm run check:version` verifies. CI additionally enforces that every `?v=` in
`index.html` and `MAPLIBRE_V` in `03_map.js` equal `ASSET_V`.

### Read source code only when
Performing a release/version bump.

### Required tests when changed
`npm run check:version`, plus the CI version-sync job's checks (see Release).

### Must not affect
Caching strategy, IndexedDB version, crypto version, backup format.

## Service Worker cache busting

`ASSET_V` is a free-form tag (e.g. `PDFTOOLKIT_20260721`). Changing it invalidates
precache and forces fresh assets. Every `?v=` in `index.html`, the `sw.js`
precache list, and `MAPLIBRE_V` must use the same `ASSET_V`.

## Test architecture

Two layers: Node built-in unit tests (`tests/**/*.test.js`) run with `node --test`
and no install; Playwright/axe e2e (`e2e/*.spec.js`) plus Lighthouse CI run in the
`e2e` CI job. The shipped app stays zero-dependency; devDependencies exist only
for CI tooling.

## Unit test

`node --test 'tests/**/*.test.js'` (also `npm test`). Covers crypto, field
migration, data integrity, schema, backup, KDATA cache, PWA, SW routing,
regressions, and PDF Toolkit pure utils. Add unit tests for pure logic you change.

## E2E test

`npm run test:e2e` (Playwright, mobile Pixel 5 profile, static python server).
Specs cover a11y, autolock, confirm, CRUD, edge-swipe, layering, offline, PDF
Toolkit, smoke, UX hardening, and onboarding. Tests must assert real behavior, not
just CSS classes.

## Release process

Order for a release:
1. Read current semver from `package.json`.
2. Set the new semver in `package.json` and, if assets changed, set a new
   `ASSET_V` in `sw.js`.
3. Run `npm run sync:version` then `npm run check:version`.
4. Manually sync every `?v=` in `index.html` and `MAPLIBRE_V` in `03_map.js` to
   the new `ASSET_V` (the sync script deliberately does not touch these; CI
   verifies them).
5. Run `npm test`, `node --check sw.js`, `find assets -name '*.js' -print0 |
   xargs -0 -n1 node --check`, and `npm run test:e2e`.
6. Confirm the diff touches only release-system locations — never IndexedDB
   version, crypto version, or backup format.

## Git / branch / PR rules

- Branch from the latest `main`; never commit directly to `main`.
- Small, purpose-scoped commits (docs / tour feat / tour test / release chore).
- Push the branch and open a Pull Request; do not merge unless the user asks.
- Never push to a different branch without explicit permission.

## Review comment / Bugbot workflow

Read every review comment. If Bugbot/Codex/CI flags an issue: verify it, fix only
within scope, add a regression test when appropriate, push, and wait for CI again.
Do not resolve a thread without code or evidence. Do not merge even when CI is
green.

## Definition of Done

A task is done only when: the requested docs/tour/tests are complete and accurate
to current code; new users see the tour and existing users are not forced to;
replay works; the tour cleans up with no ghost overlay/listener/history; no
business logic, IndexedDB schema, or crypto changed; unit + e2e + version + syntax
checks pass; the version is bumped and synchronized; CI is green; the PR is open
and unmerged.

## Absolutely-must-not-do list (agent behavior)

- Do not read the whole codebase by default or scope-creep under the guise of a
  survey.
- Do not change activation, PIN/biometric gate, unlock lifecycle, encryption,
  `masterKey`, ciphertext handling, crypto schema, IndexedDB schema/version,
  customer/asset data structures, CRUD, images, Drive, GAS, backup/restore/
  export/import, MapLibre/OSRM/distance, PDF Toolkit, CSP, security headers, API
  endpoints, tokens/secrets, LoadingManager/ErrorHandler, modal stacking, global
  z-index, edge-back, browser history, theme, weather, donate, business screens,
  Service Worker/cache strategy, dependencies, or the build system.
- Do not add CDNs, inline handlers, `innerHTML` with dynamic data, native
  dialogs, analytics, AI, or unnecessary dependencies.
- Do not change logic to make a test pass, or change tests to hide out-of-scope
  logic changes.
- Do not merge a PR.

## Rule for future updates to CLAUDE.md

Whenever you change architecture, an invariant, a public entry point, a file
responsibility, or a procedure, update the relevant section of this document in
the same change. Keep names accurate (files, functions, public APIs), keep the
progressive-disclosure structure, do not add changelogs/version history/bug
stories, do not use line numbers, and never include secrets, tokens, real API
keys, or customer data.
