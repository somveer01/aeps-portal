# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An **AEPS / fintech admin portal**, built as a **monorepo**:
- `api/` — Node.js + Express **JSON API**, JWT auth, PostgreSQL (Knex migrations + seeds).
- `app/` — **Expo / React Native** app (runs on **web, iOS, Android** from one codebase; `react-native-web` for web).

There is no build step for the API (plain Node). The app builds via Expo/Metro.

## Commands

Run the two halves in separate terminals (start the API first — the app needs it):

```bash
cd api && npm run dev      # nodemon, API on http://localhost:3000
cd app && npm run dev      # expo start; press w for web (http://localhost:8081)
```

Database (Knex):
```bash
cd api && npm run migrate            # apply latest migrations
cd api && npm run migrate:rollback   # roll back last batch
cd api && npm run seed               # run all seeds (idempotent)
cd api && npm run assign-service-icons [-- --force]   # generate+assign service icons (sharp)
```

Seeded admin login: `admin` / `Admin@12345`. Seeded **retailer** login: `retailer` / `Retailer@123` (managed user → **retailer panel**). In dev the login **OTP is `123456`** (`DEV_MASTER_OTP`) and, with `CAPTCHA_DEV_ECHO=true`, the captcha answer is printed to the API terminal.

**Two panels, one app:** `App.js` branches on `user.role` — `admin` → `DashboardScreen`; any managed user (has `user_type_id`) → `RetailerShell` (retailer panel). The sidebar menu is role-scoped via `menu_items.scope` ('admin' | 'retailer' | 'both'); `GET /api/menu` returns rows for the caller's role. Retailer APIs are under `requireManaged` and owner-scoped to `req.user.id`. External services (recharge/BBPS/AEPS/DMT/booking) run through `services/providers.service.js` (mock by default via `APP_MODE`) and the shared money `services/txnPipeline.service.js` (debit → provider → commission → refund-on-failure), idempotent + audited.

Windows/PowerShell note: `psql` lives at `C:\Program Files\PostgreSQL\17\bin\psql.exe` (not on PATH); the local DB is `fintech_aeps` (superuser `postgres`/`postgres`, port 5432). Connection comes from `api/.env` (gitignored; copy `api/.env.example`).

### Tests & lint
Backend tests use the **built-in `node --test`** runner (no extra deps): `cd api && npm test`
(runs `test/commission.test.js` + `test/api.test.js`). `test/helper.js` boots the in-process app,
mints an admin token via `token.service.signAccess(user)`, and provides fetch helpers; tests restore
any DB state they change. Lint: `cd api && npm run lint` (ESLint `.eslintrc.json`, eslint:recommended).
For quick one-offs you can still write an ad-hoc in-process script to the scratchpad and `node` it.

## Architecture (big picture)

**Auth flow (cookieless, token-based):** password + image **captcha** → **SMS OTP** (dev provider prints to terminal) → API returns a short-lived **pending JWT**, then an **access JWT** after OTP. Captcha is a stateless in-memory id→answer store (`api/src/services/captcha.service.js`). Middleware `api/src/middleware/auth.js` exposes `requireAuth` / `requirePending`. Per-account lockout + an `audit_log` back the login.

**Database-driven menu:** the app sidebar is built from the `menu_items` table (`GET /api/menu`), self-referencing `parent_id` for nesting. Adding a row makes a screen appear — no frontend change. Top level = Dashboard, a **Modules** group, and top-level **Company Banks** / **Users Manager**.

**Master-screen pattern (every admin screen follows it):** a single screen component toggles a `view` state between `'list'` and `'form'`. The list has debounced search, a status `Switch` (optimistic), row actions, and pagination; **Add/Edit opens IN-PAGE** (a form Card with a header + "ALL X" back button), **not a modal** — only delete/fund confirms use a `Modal`. Backend for each resource = migration → `repositories/<x>.repo.js` (queries, joins return `*_name` fields) → `controllers/<x>.controller.js` (validation) → routes in `api/src/routes/api.routes.js` → a `menu_items` row → app screen + `api.<x>` methods in `app/src/api/client.js` → wire the route in `app/src/screens/DashboardScreen.js`. Copy an existing screen (e.g. `ServiceCategoryScreen`, `CityMasterScreen`, `UserManagerScreen`).

**Settings & theming:** app-wide settings are a key/value `settings` table (`GET/POST /api/settings/app`, whitelisted keys). `GET /api/settings/public` (no auth) exposes theme + login banner + app name/logo for the login/boot. Theme primary/secondary are stored there; `app/src/theme.js` `applyTheme()` **mutates a shared `colors` object at startup** — `App.js` applies the saved theme BEFORE requiring the screens (so `StyleSheet.create` picks it up), and the web reloads after a theme save. **Secondary color = sidebar menu highlight.**

**Images:** generic `POST /api/uploads/image` (multer) returns `{ path: '/uploads/..' }`, served statically; controllers only accept `/uploads/...` paths (reject external URLs). Use `pickImage()` (`app/src/api/imagePicker.js`, web file-input + native picker) → `api.uploadImage(picked)` → store the path → render with `assetUrl(path)`.

**Users table is dual-purpose:** `users` holds both the admin (role `admin`, `user_type_id` null) and **managed portal users** (retailers/distributors/employees — `user_type_id NOT NULL`, extended onboarding fields, `service_access`/`module_access` jsonb, `user_code` = settings `user_id_prefix` + seq, also the login username). Users Manager lists only managed users; wallet is adjusted via `POST /api/users/:id/fund`.

**Reusable UI:** `app/src/components/UI.js` (`Button` incl. `navy` variant, `TextField` with eye toggle, `Select` searchable dropdown that opens a modal, `Alert`, `Card`), and `app/src/components/Icon.js` (inline-SVG icons keyed by the `menu_items.icon` name — add a `case` when introducing a new icon).

## Conventions & gotchas

- Module routes are `/modules/<x>`; top-level ones are `/<x>` (e.g. `/company-banks`). Match them in `DashboardScreen.js`'s route chain.
- The app is theme-mutation based: a theme change needs the app to reload to fully apply (web reload is automatic on save; native applies next launch).
- `app/AGENTS.md` (via `app/CLAUDE.md`): **Expo has changed — read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing app code.** Stick to standard RN APIs used by existing screens.
- Dev-only env flags (`api/.env`, ignored when `NODE_ENV=production`): `DEV_MASTER_OTP`, `CAPTCHA_DEV_ECHO`.
- Learning UI from screen recordings: extract frames with the bundled ffmpeg (see the `ffmpeg-for-recordings` note) and read the JPGs.

## Git & sensitive data

- **Never commit sensitive information**: passwords, API keys/tokens, `.pem`/`.key` files, `api/.env`, production IPs or credentials, DB dumps, or real personal/bank data (real mobile numbers, account numbers, Aadhaar/PAN). Seed and test data must use obviously dummy values.
- Already git-ignored: `.env`, `raw_data/`, `api/uploads/`, `.vscode/settings.json`, `*.pem`, `.claude/`. A local `pre-commit` hook (`.git/hooks/pre-commit`) blocks secret-looking files and content; never bypass it with `--no-verify`.
- Review `git diff --cached` before every commit. The repo is local only — do not push unless asked.

## Intellectual property

This is an **independent, original implementation**; reference videos are used only as functional reference. Never introduce third-party branding ("Dactilar") name/logo/content, and author all user-facing copy (Terms, Privacy, About Us). See `NOTICE.md`.
