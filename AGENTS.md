# AGENTS.md

> Project overview, architecture, conventions and data model live in `CLAUDE.md` (read it first).
> This file only adds environment/run notes for automated agents.

## Cursor Cloud specific instructions

ClientPro is a **static, zero-build, zero-runtime-dependency PWA** (vanilla JS). There is no
backend and no build step in this repo. The only local "service" is a static file server.
`devDependencies` (`@playwright/test`, `@axe-core/playwright`, `@lhci/cli`) are **CI/E2E-only** and
never ship with the app. The startup update script already runs `npm install` and installs the
Playwright Chromium browser, so no dependency setup is needed at session start.

### Running / testing (standard commands live in `package.json` + `README.md`)
- **Run the app:** `npm run serve` (→ `python3 -m http.server 8080`), then open `http://localhost:8080/`.
  The Service Worker only registers over `http://`/`https://` — never open via `file://`.
- **Unit/integration tests:** `npm test` (`node --test`, zero-dependency, needs no `npm install`).
- **Static checks (CI `static-checks` job; there is no separate linter):** `npm run check:version`,
  `python3 -m json.tool manifest.json`, `node --check sw.js`, and `node --check` over `assets/**/*.js`.
- **E2E + a11y:** `npm run test:e2e` (Playwright auto-starts its own `python3 -m http.server 8080`).
- **Lighthouse:** `npm run test:lh`.

### Non-obvious gotchas
- **First-run licensing gate:** on a fresh profile the app shows an "activation" modal that calls an
  external Google Apps Script admin server (`ADMIN_SERVER_URL` in `assets/01_config.js`) which is
  **not part of this repo**. To reach the app locally without a license, seed `localStorage` *before*
  boot and reload: `localStorage.setItem('app_activated','true'); localStorage.setItem('app_employee_id','DEMO01')`.
  This is exactly the bypass `e2e/crud.spec.js` uses (via `page.addInitScript`). After the bypass,
  the Security Setup modal lets you create a 6-digit PIN; then the app is fully usable offline.
- **Cloud features are out of scope locally:** Google Drive backup and Cloud Transfer need a
  user-deployed GAS web app + Google account; maps/road-distance/weather need outbound internet to
  public APIs. Core CRUD, PIN/biometric unlock, AES-256-GCM encryption and offline PWA behavior all
  work with just the static server.
- **Version discipline:** any asset/PWA change must keep versions in sync (`CLAUDE.md` §6.1). CI fails
  on mismatch; verify locally with `npm run check:version`.
